package serverhttp

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"

	"github.com/sorcererxw/hopter/internal/terminal"
)

type TerminalStreamHandler interface {
	AttachTerminal(terminalID string, sessionID string, browserInstanceID string, tabID string) (terminal.Session, []byte, uint64, <-chan []byte, error)
	DetachTerminal(terminalID string, subscriptionID uint64) error
	GetTerminalByID(terminalID string) (terminal.Session, error)
	TerminateBrowserTab(browserInstanceID, tabID string) int
	WriteInput(terminalID string, data []byte) error
	ResizeTerminal(terminalID string, cols, rows uint32) error
}

type terminalClientMessage struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols uint32 `json:"cols,omitempty"`
	Rows uint32 `json:"rows,omitempty"`
}

type terminalServerMessage struct {
	Type       string `json:"type"`
	TerminalID string `json:"terminalId,omitempty"`
	Data       string `json:"data,omitempty"`
	ExitCode   *int   `json:"exitCode,omitempty"`
	Message    string `json:"message,omitempty"`
}

var terminalUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin == "" {
			return true
		}
		return origin == "http://"+r.Host || origin == "https://"+r.Host
	},
}

func NewTerminalWSHandler(streams TerminalStreamHandler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		terminalID := r.PathValue("terminalId")
		sessionID := r.URL.Query().Get("session_id")
		browserInstanceID := r.URL.Query().Get("browser_instance_id")
		tabID := r.URL.Query().Get("tab_id")
		if terminalID == "" || sessionID == "" || browserInstanceID == "" || tabID == "" {
			http.Error(w, "terminal stream identity is required", http.StatusBadRequest)
			return
		}

		conn, err := terminalUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		session, replay, subID, stream, err := streams.AttachTerminal(terminalID, sessionID, browserInstanceID, tabID)
		if err != nil {
			_ = writeTerminalMessage(conn, terminalServerMessage{
				Type:    "error",
				Message: err.Error(),
			})
			return
		}
		defer func() { _ = streams.DetachTerminal(terminalID, subID) }()

		if err := writeTerminalMessage(conn, terminalServerMessage{
			Type:       "ready",
			TerminalID: session.GetID(),
		}); err != nil {
			return
		}
		if len(replay) > 0 {
			if err := writeTerminalMessage(conn, terminalServerMessage{
				Type: "output",
				Data: string(replay),
			}); err != nil {
				return
			}
		}

		readErrCh := make(chan error, 1)
		go func() {
			for {
				var message terminalClientMessage
				if err := conn.ReadJSON(&message); err != nil {
					readErrCh <- err
					return
				}
				switch message.Type {
				case "input":
					if err := streams.WriteInput(terminalID, []byte(message.Data)); err != nil {
						readErrCh <- err
						return
					}
				case "resize":
					if err := streams.ResizeTerminal(terminalID, message.Cols, message.Rows); err != nil {
						readErrCh <- err
						return
					}
				case "ping":
					if err := writeTerminalMessage(conn, terminalServerMessage{Type: "pong"}); err != nil {
						readErrCh <- err
						return
					}
				default:
					readErrCh <- fmt.Errorf("unsupported terminal message type %q", message.Type)
					return
				}
			}
		}()

		for {
			select {
			case chunk, ok := <-stream:
				if !ok {
					latest, err := streams.GetTerminalByID(terminalID)
					if err == nil {
						switch latest.Status {
						case terminal.StatusExited:
							_ = writeTerminalMessage(conn, terminalServerMessage{
								Type:     "exit",
								ExitCode: latest.ExitCode,
							})
						case terminal.StatusTerminated:
							_ = writeTerminalMessage(conn, terminalServerMessage{
								Type: "terminated",
							})
						}
					}
					return
				}
				if err := writeTerminalMessage(conn, terminalServerMessage{
					Type: "output",
					Data: string(chunk),
				}); err != nil {
					return
				}
			case err := <-readErrCh:
				if websocket.IsCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
					return
				}
				_ = writeTerminalMessage(conn, terminalServerMessage{
					Type:    "error",
					Message: err.Error(),
				})
				return
			}
		}
	})
}

func writeTerminalMessage(conn *websocket.Conn, message terminalServerMessage) error {
	payload, err := json.Marshal(message)
	if err != nil {
		return err
	}
	return conn.WriteMessage(websocket.TextMessage, payload)
}

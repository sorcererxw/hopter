package serverhttp

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"google.golang.org/protobuf/encoding/protojson"

	"github.com/sorcererxw/hopter/internal/events"
)

func NewSSEHandler(hub *events.Hub) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")

		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()

		marshaler := protojson.MarshalOptions{UseProtoNames: true}
		stream := hub.Subscribe(ctx)
		keepAlive := time.NewTicker(15 * time.Second)
		defer keepAlive.Stop()

		fmt.Fprint(w, "event: ready\ndata: {}\n\n")
		flusher.Flush()

		for {
			select {
			case <-ctx.Done():
				return
			case <-keepAlive.C:
				fmt.Fprint(w, ": keepalive\n\n")
				flusher.Flush()
			case evt, ok := <-stream:
				if !ok {
					return
				}
				payload, err := marshaler.Marshal(evt)
				if err != nil {
					fmt.Fprintf(w, "event: error\ndata: {\"message\":%q}\n\n", err.Error())
					flusher.Flush()
					continue
				}
				fmt.Fprintf(w, "event: workspace\ndata: %s\n\n", payload)
				flusher.Flush()
			}
		}
	})
}

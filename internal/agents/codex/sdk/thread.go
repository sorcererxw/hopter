package sdk

import (
	"context"
	"fmt"
	"sync"
)

type Turn struct {
	Items         []Item
	FinalResponse string
	Usage         *Usage
}

type TurnStream struct {
	Events <-chan Event
	Err    <-chan error
}

type Input interface {
	isInput()
}

type TextInput string

func (TextInput) isInput() {}

type UserInputPart interface {
	isUserInputPart()
}

type TextPart struct {
	Text string
}

func (TextPart) isUserInputPart() {}

type LocalImagePart struct {
	Path string
}

func (LocalImagePart) isUserInputPart() {}

type PartsInput []UserInputPart

func (PartsInput) isInput() {}

type Thread struct {
	runner *execRunner
	opts   ThreadOptions

	mu sync.RWMutex
	id string
}

func (t *Thread) ID() string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.id
}

func (t *Thread) setID(id string) {
	t.mu.Lock()
	t.id = id
	t.mu.Unlock()
}

func (t *Thread) RunStreamed(ctx context.Context, input Input, opts RunOptions) (*TurnStream, error) {
	schemaFile, err := createOutputSchemaFile(opts.OutputSchema)
	if err != nil {
		return nil, err
	}
	prompt, images, err := normalizeInput(input)
	if err != nil {
		_ = schemaFile.cleanup()
		return nil, err
	}
	stream, err := t.runner.run(ctx, execRequest{
		input:                 prompt,
		threadID:              t.ID(),
		images:                images,
		model:                 t.opts.Model,
		sandboxMode:           t.opts.SandboxMode,
		workingDirectory:      t.opts.WorkingDirectory,
		additionalDirectories: t.opts.AdditionalDirectories,
		skipGitRepoCheck:      t.opts.SkipGitRepoCheck,
		outputSchemaFile:      schemaFile.schemaPath,
		modelReasoningEffort:  t.opts.ModelReasoningEffort,
		networkAccessEnabled:  t.opts.NetworkAccessEnabled,
		webSearchMode:         t.opts.WebSearchMode,
		webSearchEnabled:      t.opts.WebSearchEnabled,
		approvalPolicy:        t.opts.ApprovalPolicy,
	})
	if err != nil {
		_ = schemaFile.cleanup()
		return nil, err
	}

	events := make(chan Event)
	errs := make(chan error, 1)

	go func() {
		defer close(events)
		defer close(errs)
		defer func() { _ = schemaFile.cleanup() }()

		for line := range stream.lines {
			event, err := decodeEvent(line)
			if err != nil {
				errs <- err
				return
			}
			if started, ok := event.(*ThreadStartedEvent); ok {
				t.setID(started.ThreadID)
			}
			select {
			case events <- event:
			case <-ctx.Done():
				errs <- ctx.Err()
				return
			}
		}
		if err := stream.wait(); err != nil {
			errs <- err
		}
	}()

	return &TurnStream{Events: events, Err: errs}, nil
}

func (t *Thread) Run(ctx context.Context, input Input, opts RunOptions) (Turn, error) {
	stream, err := t.RunStreamed(ctx, input, opts)
	if err != nil {
		return Turn{}, err
	}
	result := Turn{}
	var turnErr error

	for event := range stream.Events {
		switch typed := event.(type) {
		case *ItemCompletedEvent:
			result.Items = append(result.Items, typed.Item)
			if msg, ok := typed.Item.(*AgentMessageItem); ok {
				result.FinalResponse = msg.Text
			}
		case *TurnCompletedEvent:
			usage := typed.Usage
			result.Usage = &usage
		case *TurnFailedEvent:
			turnErr = fmt.Errorf("%w: %s", ErrTurnFailed, typed.Error.Message)
		case *StreamErrorEvent:
			turnErr = fmt.Errorf("%w: %s", ErrStreamFailed, typed.Message)
		}
	}

	for err := range stream.Err {
		if err != nil && turnErr == nil {
			turnErr = err
		}
	}
	if turnErr != nil {
		return Turn{}, turnErr
	}
	return result, nil
}

func normalizeInput(input Input) (string, []string, error) {
	switch value := input.(type) {
	case TextInput:
		return string(value), nil, nil
	case PartsInput:
		var textParts []string
		var images []string
		for _, part := range value {
			switch typed := part.(type) {
			case TextPart:
				textParts = append(textParts, typed.Text)
			case LocalImagePart:
				images = append(images, typed.Path)
			default:
				return "", nil, fmt.Errorf("unsupported input part %T", part)
			}
		}
		return joinTextParts(textParts), images, nil
	default:
		return "", nil, fmt.Errorf("unsupported input type %T", input)
	}
}

func joinTextParts(parts []string) string {
	switch len(parts) {
	case 0:
		return ""
	case 1:
		return parts[0]
	}
	size := 0
	for _, part := range parts {
		size += len(part)
	}
	size += (len(parts) - 1) * 2
	buf := make([]byte, 0, size)
	for i, part := range parts {
		if i > 0 {
			buf = append(buf, '\n', '\n')
		}
		buf = append(buf, part...)
	}
	return string(buf)
}

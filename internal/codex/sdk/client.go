package sdk

type Client struct {
	runner *execRunner
}

func New(opts ClientOptions) (*Client, error) {
	runner, err := newExecRunner(opts)
	if err != nil {
		return nil, err
	}
	return &Client{runner: runner}, nil
}

func (c *Client) StartThread(opts ThreadOptions) *Thread {
	return &Thread{runner: c.runner, opts: opts}
}

func (c *Client) ResumeThread(id string, opts ThreadOptions) *Thread {
	return &Thread{
		runner: c.runner,
		opts:   opts,
		id:     id,
	}
}

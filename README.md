# Hopter

Hopter lets you control local coding agents from a browser.

It runs on your own machine, keeps your repos and agent sessions local, and gives
you a lightweight workspace for checking status, continuing work, approving
actions, and reviewing results from another device.

It is not a new coding agent, a browser IDE, or a generic AI chat wrapper. Codex stays the source of truth. Hopter is the control plane around it.

## Install

```bash
brew tap --custom-remote sorcererxw/tap https://github.com/sorcererxw/tap
brew install sorcererxw/tap/hopter
hopter
```

or:

```bash
npm install -g hopter-cli
hopter
```

Hopter starts the local server and opens the browser when run from an
interactive terminal.

Useful commands:

```bash
hopter                         # run the local server in the foreground
hopter server --background     # run the same server in the background
hopter stop                    # stop the background server
hopter doctor                  # static checks and recovery suggestions
hopter server --relay          # start with hosted relay login
hopter server --relay --local=false
                               # run without a localhost browser port
```

Homebrew users can also run Hopter as a user service:

```bash
brew services start hopter
hopter doctor
brew services stop hopter
```

See [`docs/README.md`](docs/README.md) for the active documentation map.

## License

Apache-2.0

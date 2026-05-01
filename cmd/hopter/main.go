package main

import "os"

var version = "dev"
var installSource = "direct"

func main() {
	cmd := newRootCommand(version, installSource)
	cmd.SetArgs(os.Args[1:])
	if err := cmd.Execute(); err != nil {
		_, _ = os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
}

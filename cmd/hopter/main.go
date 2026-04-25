package main

import "os"

var version = "dev"
var installSource = "direct"

func main() {
	if err := newRootApp(version, installSource).Run(os.Args); err != nil {
		os.Exit(1)
	}
}

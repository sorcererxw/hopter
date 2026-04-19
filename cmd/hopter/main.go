package main

import "os"

var version = "dev"
var installSource = "direct"

func main() {
	if err := newRootCmd(version, installSource).Execute(); err != nil {
		os.Exit(1)
	}
}

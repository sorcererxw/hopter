package ui

import (
	"embed"
	"io/fs"
)

// Dist bundles the production UI that should be embedded into the Go binary.
//
//go:embed dist dist/**
var Dist embed.FS

func DistFS() fs.FS {
	sub, err := fs.Sub(Dist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}

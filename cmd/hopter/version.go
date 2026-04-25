package main

import (
	"fmt"

	"github.com/urfave/cli/v2"
)

func newVersionCmd(version string) *cli.Command {
	return &cli.Command{
		Name:  "version",
		Usage: "Print the hopter version",
		Action: func(c *cli.Context) error {
			_, err := fmt.Fprintln(c.App.Writer, version)
			return err
		},
	}
}

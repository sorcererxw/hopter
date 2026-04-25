package main

import (
	"encoding/json"
	"fmt"

	"github.com/urfave/cli/v2"

	"github.com/sorcererxw/hopter/internal/doctor"
)

func newDoctorCmd(version string, installSource string) *cli.Command {
	return &cli.Command{
		Name:  "doctor",
		Usage: "Validate whether this hopter binary can run in the current environment",
		Flags: []cli.Flag{
			&cli.BoolFlag{Name: "json", Usage: "Emit doctor results as JSON"},
		},
		Action: func(c *cli.Context) error {
			report, err := doctor.Run(version, installSource)
			if c.Bool("json") {
				encoder := json.NewEncoder(c.App.Writer)
				encoder.SetIndent("", "  ")
				if encodeErr := encoder.Encode(report); encodeErr != nil {
					return encodeErr
				}
				return err
			}

			for _, check := range report.Checks {
				fmt.Fprintf(c.App.Writer, "%-4s %s", check.Status, check.Name)
				if check.Detail != "" {
					fmt.Fprintf(c.App.Writer, " - %s", check.Detail)
				}
				fmt.Fprintln(c.App.Writer)
			}

			if err != nil {
				fmt.Fprintf(c.App.ErrWriter, "\ndoctor failed: %v\n", err)
				return err
			}

			fmt.Fprintf(c.App.Writer, "\nhopter doctor passed\n")
			return nil
		},
	}
}

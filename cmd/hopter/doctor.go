package main

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/sorcererxw/hopter/internal/doctor"
)

func newDoctorCmd(version string, installSource string) *cobra.Command {
	var jsonOutput bool
	cmd := &cobra.Command{
		Use:           "doctor",
		Short:         "Run static checks and print recovery suggestions",
		SilenceUsage:  true,
		SilenceErrors: true,
		Args:          cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			report, err := doctor.Run(version, installSource)
			if jsonOutput {
				encoder := json.NewEncoder(cmd.OutOrStdout())
				encoder.SetIndent("", "  ")
				if encodeErr := encoder.Encode(report); encodeErr != nil {
					return encodeErr
				}
				return err
			}

			for _, check := range report.Checks {
				fmt.Fprintf(cmd.OutOrStdout(), "%-4s %s", check.Status, check.Name)
				if check.Detail != "" {
					fmt.Fprintf(cmd.OutOrStdout(), " - %s", check.Detail)
				}
				if check.Suggestion != "" {
					fmt.Fprintf(cmd.OutOrStdout(), "\n     Next: %s", check.Suggestion)
				}
				fmt.Fprintln(cmd.OutOrStdout())
			}

			if err != nil {
				fmt.Fprintf(cmd.ErrOrStderr(), "\ndoctor failed: %v\n", err)
				return err
			}

			fmt.Fprintf(cmd.OutOrStdout(), "\nhopter doctor passed\n")
			return nil
		},
	}
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Emit doctor results as JSON")
	return cmd
}

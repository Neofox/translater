// Package contract holds the Go copy of the shared translation contract
// (../shared/translation, copied into data/ by cmd/syncshared). Never edit
// data/ by hand: edit shared/translation/ and run `go generate ./...`.
package contract

//go:generate go run neotranslate/cmd/syncshared

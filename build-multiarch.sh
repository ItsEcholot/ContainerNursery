#!/bin/bash

docker buildx build --push --platform linux/amd64,linux/arm64 --tag ghcr.io/itsecholot/containernursery:multiarch .
regctl image copy ghcr.io/itsecholot/containernursery:multiarch ghcr.io/itsecholot/containernursery:dev
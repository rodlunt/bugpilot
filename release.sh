#!/usr/bin/env bash
set -e

VERSION=$1
if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: ./release.sh v1.0.1"
  exit 1
fi

echo "Rebuilding action bundles..."
(cd actions/triage && npm run build --silent)
(cd actions/apply-fix && npm run build --silent)

git add actions/triage/dist actions/apply-fix/dist
git diff --cached --quiet || git commit -m "chore: rebuild action bundles for $VERSION"

git tag "$VERSION"
git push origin main "$VERSION"

echo "Done. GitHub Actions will create the release and update the major tag."

#!/usr/bin/env bash
set -e

VERSION=$1
if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: ./release.sh v1.0.1"
  exit 1
fi

echo "Rebuilding action bundles..."
(cd actions/triage && pnpm run --silent build)
(cd actions/apply-fix && pnpm run --silent build)

git add actions/triage/dist actions/apply-fix/dist
git diff --cached --quiet || git commit -m "chore: rebuild action bundles for $VERSION"

git tag "$VERSION"
git push origin main "$VERSION"

# The tag push above triggers .github/workflows/update-major-tag.yml, which is where the
# release actually gets cut (gh release create) and where the major tag gets moved. SBOM
# generation lives there too, not here: the release doesn't exist yet at this point, so there
# is nothing to attach a file to until that workflow runs, and its CI runner is the reproducible
# place to regenerate a CycloneDX SBOM per shipped package (widget, actions/triage,
# actions/apply-fix) rather than trusting whatever's on a developer's machine.
echo "Done. GitHub Actions will create the release (with SBOMs attached) and update the major tag."

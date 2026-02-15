#!/bin/bash
# Publish a filtered version of the repo to the public remote.
# Usage: ./scripts/publish-public.sh [version]
# Example: ./scripts/publish-public.sh v1.0.0

set -e

VERSION="${1:-$(date +v%Y.%m.%d)}"
REMOTE="public"
BRANCH="__public-release"
ORIGINAL_BRANCH=$(git branch --show-current)

# Verify public remote exists
if ! git remote get-url "$REMOTE" &>/dev/null; then
  echo "ERROR: Remote '$REMOTE' not found."
  echo "Add it with: git remote add public https://github.com/scott-rippey/claude-mobile-public.git"
  exit 1
fi

# Verify working tree is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Working tree has uncommitted changes. Commit or stash first."
  exit 1
fi

echo "Publishing $VERSION to $REMOTE..."

# Create temp branch from current HEAD
git checkout -b "$BRANCH"

# Remove private files listed in .publicignore
if [ -f .publicignore ]; then
  while IFS= read -r path; do
    # Skip comments and empty lines
    [[ "$path" =~ ^#.*$ || -z "$path" ]] && continue
    path=$(echo "$path" | xargs) # trim whitespace
    if git ls-files --error-unmatch "$path" &>/dev/null; then
      git rm -rf "$path" --quiet
      echo "  Removed: $path"
    fi
  done < .publicignore
fi

# Commit the filtered state
git commit -m "Release $VERSION" --quiet

# Force-push to public remote
git push "$REMOTE" "$BRANCH:main" --force
echo "Pushed to $REMOTE/main"

# Return to original branch and clean up
git checkout "$ORIGINAL_BRANCH" --quiet
git branch -D "$BRANCH" --quiet

# Tag the release on the private repo (update if exists)
git tag -f "public-$VERSION" 2>/dev/null
echo "Tagged: public-$VERSION"

echo ""
echo "Published $VERSION to $REMOTE"
echo "Public repo: $(git remote get-url $REMOTE)"

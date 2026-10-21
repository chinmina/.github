# Setting up package repositories

This guide creates the two repositories the release pipeline publishes into: `<OWNER>/homebrew-tap` for Homebrew casks, and `<OWNER>/nixpkgs` for Nix recipes. Each owner needs them once, and every tool the owner releases shares them.

Skip a repository that already exists, or one for a channel your tools disable.

## Before you start

- [GitHub CLI](https://cli.github.com/) (`gh`), signed in with permission to create repositories for `<OWNER>`
- [Nix](https://nixos.org/download/) with flakes enabled, to lock the `nixpkgs` flake
- The release GitHub App's numeric ID, `<APP_ID>`, from its settings page. On the `octo-sts` token source, use the octo-sts App's ID.

## Homebrew tap

The tap must be named `homebrew-tap`, so users can run `brew install <OWNER>/tap/<TOOL>`. goreleaser writes each cask to `Casks/<TOOL>.rb`.

1. Create the repository with an initial commit.

   ```sh
   gh repo create "<OWNER>/homebrew-tap" --public --add-readme \
     --description "Homebrew casks for tools published by <OWNER>"
   ```

2. Give the App that mints tokens access to the repository: the release App, or the octo-sts App on the `octo-sts` token source. Under the owner's **Settings → GitHub Apps → (App) → Configure**, add `homebrew-tap` to the selected repositories.

3. If a ruleset protects the default branch, add the App as a bypass actor. goreleaser pushes unsigned commits directly to the default branch, so a pull request or signed-commit rule rejects them otherwise. Follow [Ruleset bypass](#ruleset-bypass) with `<PACKAGE_REPO>` set to `homebrew-tap`.

## Nix package repository

goreleaser writes each recipe to `pkgs/<TOOL>/default.nix`. Two files at the repository root expose every recipe: `default.nix` for non-flake users and `flake.nix` for flake users. Both discover packages from the `pkgs/` directories, so a new tool needs no edit.

1. Create the repository and clone it.

   ```sh
   gh repo create "<OWNER>/nixpkgs" --public --clone \
     --description "Nix packages for tools published by <OWNER>"
   cd nixpkgs
   ```

2. Create `pkgs/.gitkeep`, so the directory exists before the first release.

   ```sh
   mkdir pkgs && touch pkgs/.gitkeep
   ```

3. Create `default.nix`:

   ```nix
   # Package set for non-flake users. Every directory under ./pkgs is a package,
   # so a tool published by goreleaser needs no edit here.
   #
   # The set is a fixed point, so a recipe can take a sibling package as an
   # argument. `lib` is separate so the overlay can pass one that does not come
   # from `final`, which would make the attribute names recurse.
   {
     pkgs ? import <nixpkgs> { },
     lib ? pkgs.lib,
   }:
   let
     names = lib.attrNames (lib.filterAttrs (_: type: type == "directory") (builtins.readDir ./pkgs));
   in
   lib.fix (self: lib.genAttrs names (name: lib.callPackageWith (pkgs // self) ./pkgs/${name} { }))
   ```

4. Create `flake.nix`:

   ```nix
   {
     description = "Nix packages for projects published by <OWNER>";

     # Supplies the build helpers the recipes use. Nothing is published to nixpkgs.
     inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

     outputs =
       { self, nixpkgs }:
       let
         inherit (nixpkgs) lib;
         # Every platform goreleaser's nix publisher can emit. nixpkgs 26.05 is
         # the last release supporting x86_64-darwin: moving to 26.11 means
         # deleting "x86_64-darwin" below, or evaluation fails.
         systems = [
           "x86_64-linux"
           "aarch64-linux"
           "i686-linux"
           "armv6l-linux"
           "armv7l-linux"
           "x86_64-darwin"
           "aarch64-darwin"
         ];
         forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
       in
       {
         # Each system lists only the tools whose recipe has an archive for it.
         packages = forAllSystems (
           pkgs:
           lib.filterAttrs (_: pkg: lib.meta.availableOn pkgs.stdenv.hostPlatform pkg) (
             import ./default.nix { inherit pkgs; }
           )
         );
         overlays.default = final: _prev: import ./default.nix { pkgs = final; inherit lib; };
       };
   }
   ```

5. Lock the flake, and confirm it evaluates. With no recipes yet, the package set is empty.

   ```sh
   git add -A
   nix flake lock
   nix eval .#packages.x86_64-linux --apply builtins.attrNames
   ```

   The last command prints `[ ]`.

6. Commit and push.

   ```sh
   git add -A
   git commit -m "feat: add package set for goreleaser recipes"
   git push
   ```

7. Give the release App access to the repository, as for the tap.

8. If a ruleset protects the default branch, follow [Ruleset bypass](#ruleset-bypass) with `<PACKAGE_REPO>` set to `nixpkgs`.

[jamestelfer/nixpkgs](https://github.com/jamestelfer/nixpkgs) is a working instance of this layout.

## Ruleset bypass

Run these commands for each ruleset that protects the package repository's default branch.

1. List the rulesets.

   ```sh
   gh api "repos/<OWNER>/<PACKAGE_REPO>/rulesets" --jq '.[] | [.id, .target, .name] | @tsv'
   ```

2. Add the App as an `always` bypass actor to each ruleset with target `branch`. `<RULESET_ID>` is the ruleset's ID.

   ```sh
   gh api "repos/<OWNER>/<PACKAGE_REPO>/rulesets/<RULESET_ID>" \
     | jq --argjson app "<APP_ID>" \
       '{name, target, enforcement, conditions, rules,
         bypass_actors: ((.bypass_actors // []) + [{actor_type: "Integration", actor_id: $app, bypass_mode: "always"}])}' \
     | gh api --method PUT "repos/<OWNER>/<PACKAGE_REPO>/rulesets/<RULESET_ID>" --input -
   ```

3. Confirm the bypass.

   ```sh
   gh api "repos/<OWNER>/<PACKAGE_REPO>/rulesets/<RULESET_ID>" --jq '.bypass_actors'
   ```

   The output includes `{"actor_id":<APP_ID>,"actor_type":"Integration","bypass_mode":"always"}`.

## Users install with

```sh
brew install <OWNER>/tap/<TOOL>
nix profile install github:<OWNER>/nixpkgs#<TOOL>
```

The cask and the recipe point at release assets. Both return 404 until the release workflow publishes the release.

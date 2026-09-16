{
  description = "placitum — capability-secure shell language (dev shell)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      forAllSystems = nixpkgs.lib.genAttrs [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          # ponytail: node only — every JS dep comes from npm (Section 8.3 allow-list),
          # so the shell never needs rebuilding for dep changes.
          default = pkgs.mkShell {
            packages = [ pkgs.nodejs_22 ];
          };
        }
      );
    };
}

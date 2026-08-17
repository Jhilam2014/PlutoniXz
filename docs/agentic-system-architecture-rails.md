# Architecture Branches rail design

The Architecture view now reads as a contained hierarchy rather than a field of independent connector curves:

`Project genesis → source zone rail → functionality pod → child / branch twig`

The rail is presentation-only. It bundles repeated project-to-functionality containment routes by project and source zone, and retains the original relationship IDs in `data-member-link-ids`. Local child and branch relationships remain separate SVG paths. The very high-fanout unmapped-evidence fallback gets a labelled local fanout rail; it is not reassigned to a guessed functionality.

Selection strengthens its exact rail and local relationships, but does not hide or fade surrounding topology. Source-zone boards expand if a person drags a saved node outside its original geometry.

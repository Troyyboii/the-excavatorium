# Apply canonical lantern branding

## Changes
- Derive favicon, Apple touch, standard PWA, and maskable PWA images directly from the supplied transparent lantern artwork.
- Keep the existing icon filenames and manifest references so install and offline behavior remain unchanged.
- Add the same lantern beside “The Excavatorium” in the desktop sidebar and mobile header, without changing navigation or layout structure.
- Check app-controlled surfaces for any remaining default Lovable brand icon and replace only where present.

## Verification
- Confirm each generated icon contains the supplied lantern at the required size and transparency/background treatment.
- Run the existing focused checks and inspect the live preview at mobile and desktop sizes.
- Report the exact changed files and leave publishing untouched.

## Technical details
- Standard icons use the original transparent pixels, proportionally scaled and centered without reinterpretation.
- Maskable icons add safe dark framing around that same source image so launchers can crop safely.
- The shell uses a small project asset derived from the canonical lantern; no colors, typography, behavior, or data code changes.

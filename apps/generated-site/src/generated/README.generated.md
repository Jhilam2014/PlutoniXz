# Generated App Handoff

This generated Vite React page renders a premium Vogue Elegance commerce landing page with cart checkout, payment options, GST, and invoice preview.

## Orchestrator Plan

- Orchestrator: `plutonix-fullstack-agent`
- Objective: `Generate a professional landing page for digital product.`
- Instruction hash: `e413c726c6b2fdb43422c467a6a678fe19d8eb1026faeea435e2255d7fc0865a`
- Page type: `professional_landing_page`
- Audience: professional users
- Tone: professional, premium

## Implemented Sections

- Responsive hero branded for Vogue Elegance, with local product imagery and device-safe text sizing
- Proof strip for boutique ordering signals
- Boutique workflow section
- Separate New arrivals and Regular items catalog sections
- Product cards with locally stored bag photos, sale price, compare-at price, details, availability, a small source logo badge, and Add+ buttons
- Cart section with quantity controls, remove actions, clear cart, and live payable total
- Checkout popup window with standard payment methods: UPI, credit/debit card, net banking, wallets, EMI, and cash on pickup
- Invoice view with invoice number, line-item totals, subtotal, GST at 18%, pickup/local coordination fee, and payable total
- Materials and styling section
- Visible self-contained Google-style Gmail login button in the navigation
- Admin-only inventory list summaries and stock controls for `jhilam.astro@gmail.com`
- Contact section with WhatsApp, Instagram, phone, email, and map actions using inline SVG icons
- Brand-colored local map panel linked to the real Google Maps location
- CTA for WhatsApp enquiry
- The Location link has been removed from the navigation bar

## Data And Integration Notes

- The public storefront brand is Vogue Elegance.
- Product names, prices, compare-at prices, sale labels, sold-out labels, and photos were checked from public Magnolia Bags new-arrivals pages on June 25, 2026.
- Product photos are stored locally in `src/generated/assets` so runtime rendering stays self-contained.
- Cart, checkout, payment method selection, GST, and invoice calculations run locally in React state.
- The payment popup is a checkout preview and does not collect card, UPI, wallet, or banking credentials.
- The Google Maps action uses a direct map link. The visible map is a local themed illustration, not an embedded tracking iframe.
- The Google-style login is a local demo control and does not load OAuth scripts, store passwords, use secrets, or make backend calls.

## Admin Visibility

The admin inventory lists render only after signing in through the local Google-style button with:

- `jhilam.astro@gmail.com`

The entered Gmail address is stored as `localStorage.vogueEleganceUserEmail` for this generated demo.

## File Operations

- modify: `src/generated/generatedPage.jsx` - Render the Vogue Elegance storefront, Add+ product buttons, cart panel, checkout popup, payment choices, GST invoice view, visible Google-style login, admin inventory lists, catalog sections, contacts, and themed map.
- modify: `src/generated/generatedPage.css` - Apply responsive premium retail styling, Add+ button sizing, cart controls, checkout modal, payment options, invoice panel, login controls, and admin inventory summaries.
- add/modify: `src/generated/catalogData.js` - Store brand, contact, product, GST, payment method, material, and source data.
- add: `src/generated/assets/*.jpg` - Store local product photos.
- add/modify: `src/generated/README.generated.md` - Document this generated handoff.
- modify: `src/generated/metadata.json` - Record current build metadata and orchestrator details.
- delete: `src/generated/deprecatedGeneratedPage.jsx` - Obsolete generated page module was not present.

import pinkBackpack from "./assets/magnolia-pink-backpack.jpg";
import brownDuffle from "./assets/magnolia-brown-duffle.jpg";
import khakiDuffle from "./assets/magnolia-khaki-duffle.jpg";
import blackTexturedTote from "./assets/magnolia-black-textured-tote.jpg";
import beigeDuffle from "./assets/magnolia-beige-duffle.jpg";
import pinkShoulder from "./assets/magnolia-pink-shoulder.jpg";
import blackTote from "./assets/magnolia-black-tote.jpg";

export const brand = {
  name: "Vogue Elegance",
  location: "Kalyan Nagar, Bengaluru",
  eyebrow: "Premium handbags, curated locally",
  headline: "Elegant bags for workdays, evenings, and every polished arrival.",
  subhead:
    "Vogue Elegance brings refined handbags and accessories to Kalyan Nagar with a quiet luxury palette, practical silhouettes, and easy direct ordering.",
  adminEmail: "jhilam.astro@gmail.com"
};

export const contact = {
  name: "Vogue Elegance",
  category: "Ladies handbags and accessories boutique",
  address:
    "Hennur Main Rd, next to LensKart, opposite SBI Bank, HBR Layout 4th Block, Meganahalli, Kalyan Nagar, Bengaluru, Karnataka 560043",
  phoneDisplay: "+91 79751 01016",
  phoneTel: "+917975101016",
  whatsappDisplay: "+91 79751 01016",
  whatsappUrl: "https://wa.me/917975101016",
  instagram: "@vogueelegance_bangalore",
  instagramUrl: "https://www.instagram.com/",
  email: "shivanisajjad@gmail.com",
  coordinates: "13.0232 N, 77.6407 E",
  mapLabel: "Vogue Elegance, Kalyan Nagar",
  mapLink: "https://maps.app.goo.gl/2m8U31zMFXjHZU8X8"
};

export const proof = [
  "Curated handbag edit",
  "Cart checkout preview",
  "Kalyan Nagar pickup",
  "GST invoice breakup"
];

export const commerceSettings = {
  gstRate: 0.18,
  gstLabel: "GST 18%",
  shippingLabel: "Boutique pickup / local coordination",
  shippingFee: 0,
  invoicePrefix: "VE"
};

export const paymentMethods = [
  {
    id: "upi",
    name: "UPI",
    detail: "Google Pay, PhonePe, Paytm, BHIM, or any UPI app"
  },
  {
    id: "cards",
    name: "Credit / Debit Card",
    detail: "Visa, Mastercard, RuPay, and Amex card payment"
  },
  {
    id: "netbanking",
    name: "Net Banking",
    detail: "All major Indian banks"
  },
  {
    id: "wallets",
    name: "Wallets",
    detail: "Paytm Wallet, Amazon Pay, and supported wallets"
  },
  {
    id: "emi",
    name: "EMI",
    detail: "Card EMI options shown during payment confirmation"
  },
  {
    id: "cod",
    name: "Cash on Pickup",
    detail: "Pay at the Kalyan Nagar boutique during pickup"
  }
];

export const heroGallery = [
  { src: blackTote, alt: "Black structured tote from the Vogue Elegance edit" },
  { src: pinkBackpack, alt: "Pink two tone backpack from the new arrival edit" },
  { src: khakiDuffle, alt: "Khaki quilted duffle from the Vogue Elegance edit" }
];

export const newArrivals = [
  {
    id: "VE-NA-001",
    sourceBrand: "Magnolia",
    name: "Pink PU Leather Solid One Size Women Backpack",
    category: "Backpack",
    material: "Premium PU leather",
    dimensions: "29 x 12 x 28 cm",
    color: "Pink two tone",
    price: 3450,
    compareAt: 4599,
    stock: 6,
    availability: "Sale",
    image: pinkBackpack,
    imageAlt: "Pink PU leather women backpack with Magnolia logo",
    sourceUrl:
      "https://magnoliabags.com/products/magnolia-pink-pu-leather-solid-one-size-women-backpack-mg-7264-pink"
  },
  {
    id: "VE-NA-002",
    sourceBrand: "Magnolia",
    name: "Brown PU Leather Quilted One Size Unisex Duffle Bag",
    category: "Duffle bag",
    material: "PU leather",
    dimensions: "Weekend carry",
    color: "Brown quilted",
    price: 4125,
    compareAt: 5499,
    stock: 0,
    availability: "Sold out",
    image: brownDuffle,
    imageAlt: "Brown quilted unisex duffle bag with Magnolia logo",
    sourceUrl:
      "https://magnoliabags.com/collections/new-arrivals"
  },
  {
    id: "VE-NA-003",
    sourceBrand: "Magnolia",
    name: "Khaki PU Leather Quilted One Size Unisex Duffle Bag",
    category: "Duffle bag",
    material: "PU leather",
    dimensions: "Weekend carry",
    color: "Khaki",
    price: 4125,
    compareAt: 5499,
    stock: 8,
    availability: "Sale",
    image: khakiDuffle,
    imageAlt: "Khaki quilted unisex duffle bag with Magnolia logo",
    sourceUrl:
      "https://magnoliabags.com/collections/new-arrivals"
  },
  {
    id: "VE-NA-004",
    sourceBrand: "Magnolia",
    name: "Black PU Leather Textured One Size Unisex Tote",
    category: "Tote",
    material: "PU leather and fabric",
    dimensions: "One size",
    color: "Black textured",
    price: 4125,
    compareAt: 5499,
    stock: 9,
    availability: "Sale",
    image: blackTexturedTote,
    imageAlt: "Black textured unisex tote with Magnolia logo",
    sourceUrl:
      "https://magnoliabags.com/collections/new-arrivals"
  }
];

export const regularItems = [
  {
    id: "VE-RG-001",
    sourceBrand: "Magnolia",
    name: "Beige PU Leather Quilted One Size Unisex Duffle Bag",
    category: "Duffle bag",
    material: "PU leather",
    dimensions: "One size",
    color: "Beige quilted",
    price: 4125,
    compareAt: 5499,
    stock: 7,
    availability: "Sale",
    image: beigeDuffle,
    imageAlt: "Beige quilted unisex duffle bag with Magnolia logo",
    sourceUrl:
      "https://magnoliabags.com/collections/new-arrivals"
  },
  {
    id: "VE-RG-002",
    sourceBrand: "Magnolia",
    name: "Pink PU Leather Solid One Size Women Shoulder Bag",
    category: "Shoulder bag",
    material: "PU leather",
    dimensions: "One size",
    color: "Pink",
    price: 3000,
    compareAt: 3999,
    stock: 10,
    availability: "Sale",
    image: pinkShoulder,
    imageAlt: "Pink shoulder bag with Magnolia logo",
    sourceUrl:
      "https://magnoliabags.com/collections/new-arrivals"
  },
  {
    id: "VE-RG-003",
    sourceBrand: "Magnolia",
    name: "Black PU Leather Solid One Size Women Tote",
    category: "Tote",
    material: "PU leather",
    dimensions: "One size",
    color: "Black",
    price: 4125,
    compareAt: 5499,
    stock: 12,
    availability: "Sale",
    image: blackTote,
    imageAlt: "Black solid women tote with Magnolia logo",
    sourceUrl:
      "https://magnoliabags.com/collections/new-arrivals"
  }
];

export const serviceHighlights = [
  {
    title: "Personal bag edit",
    body:
      "Choose by purpose: office tote, evening shoulder bag, weekend duffle, or compact everyday carry."
  },
  {
    title: "Local boutique assistance",
    body:
      "Add items to cart, review GST breakup, then call, message, or visit for final stock guidance."
  },
  {
    title: "Invoice-ready checkout",
    body:
      "A checkout popup previews payment choices and a clear invoice statement before order confirmation."
  }
];

export const materials = [
  {
    title: "Premium PU leather",
    body:
      "Selected items use polished PU leather finishes that balance structure, wipe-clean utility, and a refined look."
  },
  {
    title: "Quilted and textured surfaces",
    body:
      "Duffle and tote styles add dimension through quilting, grain, and contrast panels without overwhelming daily outfits."
  },
  {
    title: "Work-to-evening silhouettes",
    body:
      "The catalog separates fresh arrivals from regular picks so customers can scan newness and staple styles quickly."
  }
];

export const sourceNotes = [
  "Magnolia new-arrival product names, sale prices, compare-at prices, and availability labels were checked against the public Magnolia Bags new-arrivals page on June 25, 2026.",
  "Product photos are saved locally in src/generated/assets from public Magnolia product image URLs so the rendered app does not make runtime image requests.",
  "The Google Maps destination is provided as a direct map link and presented with a local brand-colored map illustration rather than an embedded tracking iframe."
];

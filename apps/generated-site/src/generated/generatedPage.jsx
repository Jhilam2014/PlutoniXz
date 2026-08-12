import { useEffect, useMemo, useState } from "react";
import {
  brand,
  commerceSettings,
  contact,
  heroGallery,
  materials,
  newArrivals,
  paymentMethods,
  proof,
  regularItems,
  serviceHighlights
} from "./catalogData.js";

export const generatedMetadata = {
  instructionHash: "e413c726c6b2fdb43422c467a6a678fe19d8eb1026faeea435e2255d7fc0865a",
  generatedAt: "2026-06-26T00:00:00.000Z",
  title: "Vogue Elegance"
};

const formatInr = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(amount) || 0);

function Icon({ name }) {
  const paths = {
    phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.48 19.48 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.77.63 2.6a2 2 0 0 1-.45 2.11L8.02 9.7a16 16 0 0 0 6.29 6.29l1.27-1.27a2 2 0 0 1 2.11-.45c.83.3 1.7.51 2.6.63A2 2 0 0 1 22 16.92Z",
    whatsapp:
      "M20.52 3.48A11.82 11.82 0 0 0 2.44 17.6L2 22l4.52-1.16A11.82 11.82 0 0 0 20.52 3.48ZM12 20a8 8 0 0 1-4.08-1.12l-.29-.17-2.42.62.65-2.35-.19-.31A8 8 0 1 1 12 20Zm4.44-5.8c-.24-.12-1.43-.7-1.65-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06a6.54 6.54 0 0 1-3.24-2.82c-.24-.42.24-.39.68-1.3.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.59 4.12 3.63.58.25 1.03.4 1.38.51.58.18 1.1.16 1.52.1.46-.07 1.43-.58 1.63-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z",
    instagram:
      "M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm5 5.2A4.8 4.8 0 1 0 12 16.8 4.8 4.8 0 0 0 12 7.2Zm0 2A2.8 2.8 0 1 1 12 14.8 2.8 2.8 0 0 1 12 9.2Zm5.1-2.75a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z",
    mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 4 8 5 8-5",
    map: "M12 21s7-5.2 7-12A7 7 0 0 0 5 9c0 6.8 7 12 7 12Zm0-9.5A2.5 2.5 0 1 0 12 6a2.5 2.5 0 0 0 0 5.5Z",
    bag: "M6 7h12l1 14H5L6 7Zm3 0a3 3 0 0 1 6 0",
    cart: "M6 6h15l-1.5 8.5H8L6 3H3m6 16.5a1.5 1.5 0 1 0 0 .01Zm9 0a1.5 1.5 0 1 0 0 .01Z",
    card: "M3 6h18v12H3V6Zm0 4h18m-14 4h4",
    close: "M6 6l12 12M18 6 6 18"
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
      <path d={paths[name]} />
    </svg>
  );
}

const buildInvoice = (cartItems) => {
  const subtotal = cartItems.reduce((total, item) => total + item.price * item.quantity, 0);
  const gst = Math.round(subtotal * commerceSettings.gstRate);
  const shipping = commerceSettings.shippingFee;
  const total = subtotal + gst + shipping;

  return {
    invoiceNumber: `${commerceSettings.invoicePrefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-001`,
    subtotal,
    gst,
    shipping,
    total
  };
};

function ProductCard({ product, onAddToCart, cartQuantity }) {
  const soldOut = product.stock === 0;

  return (
    <article className={`product-card ${soldOut ? "sold-out" : ""}`}>
      <div className="product-image-wrap">
        <img src={product.image} alt={product.imageAlt} loading="lazy" />
        <span className="source-badge">{product.sourceBrand}</span>
      </div>
      <div className="product-content">
        <div className="product-topline">
          <code>{product.id}</code>
          <span className={`availability ${soldOut ? "is-unavailable" : "is-available"}`}>
            {soldOut ? "Sold out" : product.availability}
          </span>
        </div>
        <h3>{product.name}</h3>
        <p>
          {product.category} in {product.color}. {product.material}. {product.dimensions}.
        </p>
        <div className="price-row">
          <strong>{formatInr(product.price)}</strong>
          <span>{formatInr(product.compareAt)}</span>
        </div>
        <div className="product-actions">
          <a href={product.sourceUrl} target="_blank" rel="noreferrer">
            Item details
          </a>
          <button
            type="button"
            className={soldOut ? "disabled" : ""}
            onClick={() => onAddToCart(product)}
            disabled={soldOut}
          >
            <Icon name="cart" />
            {cartQuantity ? `Added (${cartQuantity})` : "Add+"}
          </button>
        </div>
      </div>
    </article>
  );
}

function CatalogSection({ id, eyebrow, title, intro, products, onAddToCart, cartItems }) {
  return (
    <section className="catalog-section" id={id}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <p>{intro}</p>
      </div>
      <div className="product-grid">
        {products.map((product) => (
          <ProductCard
            product={product}
            key={product.id}
            onAddToCart={onAddToCart}
            cartQuantity={cartItems.find((item) => item.id === product.id)?.quantity || 0}
          />
        ))}
      </div>
    </section>
  );
}

function CartPanel({ cartItems, invoice, onChangeQuantity, onRemoveItem, onCheckout, onClearCart }) {
  const itemCount = cartItems.reduce((total, item) => total + item.quantity, 0);

  return (
    <section className="cart-section" id="cart" aria-labelledby="cart-title">
      <div className="cart-shell">
        <div className="cart-summary">
          <p className="eyebrow">Shopping cart</p>
          <h2 id="cart-title">Review your selected bags before checkout.</h2>
          <p>
            Add products from the catalog, confirm quantities, and open the checkout popup to choose a
            payment method with GST invoice breakup.
          </p>
        </div>

        <div className="cart-card" aria-live="polite">
          {cartItems.length === 0 ? (
            <div className="empty-cart">
              <Icon name="cart" />
              <strong>Your cart is empty</strong>
              <span>Add an available product to prepare the checkout invoice.</span>
            </div>
          ) : (
            <>
              <div className="cart-items">
                {cartItems.map((item) => (
                  <article className="cart-item" key={item.id}>
                    <img src={item.image} alt={item.imageAlt} />
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.id}</span>
                      <small>{formatInr(item.price)} each</small>
                    </div>
                    <div className="quantity-stepper" aria-label={`Quantity for ${item.name}`}>
                      <button type="button" onClick={() => onChangeQuantity(item.id, -1)} aria-label={`Decrease ${item.name}`}>
                        -
                      </button>
                      <span>{item.quantity}</span>
                      <button type="button" onClick={() => onChangeQuantity(item.id, 1)} aria-label={`Increase ${item.name}`}>
                        +
                      </button>
                    </div>
                    <button className="remove-button" type="button" onClick={() => onRemoveItem(item.id)}>
                      Remove
                    </button>
                  </article>
                ))}
              </div>

              <div className="cart-totals">
                <span>{itemCount} item{itemCount === 1 ? "" : "s"}</span>
                <strong>{formatInr(invoice.total)}</strong>
              </div>
              <div className="cart-buttons">
                <button type="button" onClick={onClearCart}>
                  Clear cart
                </button>
                <button className="checkout-button" type="button" onClick={onCheckout}>
                  <Icon name="card" />
                  Checkout & payment
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function CheckoutModal({ cartItems, invoice, selectedPayment, setSelectedPayment, onClose, onConfirm }) {
  return (
    <div className="checkout-overlay" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
      <div className="checkout-modal">
        <div className="checkout-header">
          <div>
            <p className="eyebrow">Secure checkout preview</p>
            <h2 id="checkout-title">Payment options and invoice view</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close checkout">
            <Icon name="close" />
          </button>
        </div>

        <div className="checkout-grid">
          <section className="payment-panel" aria-labelledby="payment-title">
            <h3 id="payment-title">Choose payment method</h3>
            <div className="payment-options">
              {paymentMethods.map((method) => (
                <label className="payment-option" key={method.id}>
                  <input
                    type="radio"
                    name="payment-method"
                    value={method.id}
                    checked={selectedPayment === method.id}
                    onChange={(event) => setSelectedPayment(event.target.value)}
                  />
                  <span>
                    <strong>{method.name}</strong>
                    <small>{method.detail}</small>
                  </span>
                </label>
              ))}
            </div>
            <p className="payment-note">
              This demo does not collect card, UPI, banking, or wallet credentials. Final payment is
              confirmed directly with the boutique.
            </p>
          </section>

          <section className="invoice-panel" aria-labelledby="invoice-title">
            <div className="invoice-head">
              <div>
                <span>Invoice</span>
                <strong id="invoice-title">{invoice.invoiceNumber}</strong>
              </div>
              <div>
                <span>Date</span>
                <strong>{new Date().toLocaleDateString("en-IN")}</strong>
              </div>
            </div>

            <div className="invoice-lines">
              {cartItems.map((item) => (
                <div className="invoice-line" key={item.id}>
                  <span>
                    {item.name}
                    <small>{item.quantity} x {formatInr(item.price)}</small>
                  </span>
                  <strong>{formatInr(item.price * item.quantity)}</strong>
                </div>
              ))}
            </div>

            <div className="invoice-breakup">
              <div>
                <span>Subtotal</span>
                <strong>{formatInr(invoice.subtotal)}</strong>
              </div>
              <div>
                <span>{commerceSettings.gstLabel}</span>
                <strong>{formatInr(invoice.gst)}</strong>
              </div>
              <div>
                <span>{commerceSettings.shippingLabel}</span>
                <strong>{invoice.shipping === 0 ? "Free" : formatInr(invoice.shipping)}</strong>
              </div>
              <div className="grand-total">
                <span>Payable total</span>
                <strong>{formatInr(invoice.total)}</strong>
              </div>
            </div>
          </section>
        </div>

        <div className="checkout-footer">
          <button type="button" onClick={onClose}>
            Continue shopping
          </button>
          <button className="checkout-button" type="button" onClick={onConfirm}>
            Confirm checkout preview
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateUserModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ name: "", email: "", role: "customer" });

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const submitUser = (event) => {
    event.preventDefault();
    onCreate({
      id: `user-${Date.now()}`,
      name: form.name.trim() || "New user",
      email: form.email.trim().toLowerCase(),
      role: form.role
    });
  };

  return (
    <div className="app-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="app-modal" role="dialog" aria-modal="true" aria-labelledby="create-user-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="app-modal-header">
          <div>
            <p className="eyebrow">User access</p>
            <h2 id="create-user-title">Create Users</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close create user modal">
            <Icon name="close" />
          </button>
        </header>
        <form className="modal-form" onSubmit={submitUser}>
          <label>
            Full name
            <input value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Customer name" />
          </label>
          <label>
            Gmail address
            <input type="email" required value={form.email} onChange={(event) => updateField("email", event.target.value)} placeholder="name@gmail.com" />
          </label>
          <label>
            Role
            <select value={form.role} onChange={(event) => updateField("role", event.target.value)}>
              <option value="customer">Customer</option>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="primary-action" type="submit">Create user</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function CreateCategoryModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ name: "", description: "" });

  const submitCategory = (event) => {
    event.preventDefault();
    onCreate({
      id: `category-${Date.now()}`,
      name: form.name.trim() || "New category",
      description: form.description.trim() || "Local admin-created category."
    });
  };

  return (
    <div className="app-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="app-modal" role="dialog" aria-modal="true" aria-labelledby="create-category-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="app-modal-header">
          <div>
            <p className="eyebrow">Catalog grouping</p>
            <h2 id="create-category-title">Create category</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close create category modal">
            <Icon name="close" />
          </button>
        </header>
        <form className="modal-form" onSubmit={submitCategory}>
          <label>
            Category name
            <input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Evening bags" />
          </label>
          <label>
            Description
            <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Describe this category for the admin catalog." />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="primary-action" type="submit">Create category</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AdminTable({ products, users, categories, onOpenCreateUser, onOpenCreateCategory }) {
  const [rows, setRows] = useState(products);
  const inventoryGroups = useMemo(
    () => [
      { label: "New arrivals", products: rows.filter((product) => product.id.includes("NA")) },
      { label: "Regular items", products: rows.filter((product) => product.id.includes("RG")) },
      ...categories.map((category) => ({ label: category.name, products: rows.filter((product) => product.category === category.name) }))
    ],
    [categories, rows]
  );

  const updateStock = (productId, delta) => {
    setRows((current) =>
      current.map((product) =>
        product.id === productId ? { ...product, stock: Math.max(0, product.stock + delta) } : product
      )
    );
  };

  return (
    <section className="admin-section" id="admin" aria-labelledby="admin-title">
      <div className="section-heading admin-heading">
        <div>
          <p className="eyebrow">Admin inventory lists</p>
          <h2 id="admin-title">Private inventory view for Vogue Elegance.</h2>
        </div>
        <div className="admin-actions">
          <button type="button" onClick={onOpenCreateUser}>Add user</button>
          <button type="button" onClick={onOpenCreateCategory}>Create category</button>
        </div>
        <p>
          This panel appears only after Google sign-in with the approved Gmail address. Stock
          adjustments, users, and categories are local to this generated build.
        </p>
      </div>
      <div className="inventory-lists" aria-label="Inventory list summaries">
        {inventoryGroups.map((group) => (
          <article key={group.label}>
            <span>{group.label}</span>
            <strong>{group.products.length} SKUs</strong>
            <p>
              {group.products.reduce((total, product) => total + product.stock, 0)} units available
            </p>
          </article>
        ))}
      </div>
      <div className="admin-user-list" aria-label="Created users">
        <span>Created users</span>
        <strong>{users.length}</strong>
        <p>{users.length ? users.map((user) => `${user.name} (${user.role})`).join(", ") : "No additional users created yet."}</p>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Section</th>
              <th>Stock</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((product) => (
              <tr key={product.id}>
                <td>
                  <strong>{product.name}</strong>
                  <code>{product.id}</code>
                </td>
                <td>{product.id.includes("NA") ? "New arrival" : "Regular"}</td>
                <td>
                  <div className="stock-controls">
                    <button type="button" onClick={() => updateStock(product.id, -1)} aria-label={`Decrease ${product.name}`}>
                      -
                    </button>
                    <span>{product.stock}</span>
                    <button type="button" onClick={() => updateStock(product.id, 1)} aria-label={`Increase ${product.name}`}>
                      +
                    </button>
                  </div>
                </td>
                <td>{formatInr(product.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GoogleLogin({ userEmail, emailInput, setEmailInput, loginOpen, setLoginOpen, onLogin, onLogout, onOpenCreateUser, isAdmin, authMessage }) {
  return (
    <div className="google-login">
      {userEmail ? (
        <div className="signed-in-pill">
          <span className="google-mark" aria-hidden="true">
            G
          </span>
          <span>
            <small>{isAdmin ? "Admin signed in" : "Signed in"}</small>
            <strong>{userEmail}</strong>
          </span>
          <button type="button" onClick={onLogout}>
            Sign out
          </button>
          <button type="button" onClick={onOpenCreateUser}>
            Create Users
          </button>
        </div>
      ) : (
        <>
          <button className="google-button" type="button" onClick={() => setLoginOpen((open) => !open)}>
            <span className="google-mark" aria-hidden="true">
              G
            </span>
            Continue with Google
          </button>
          {loginOpen && (
            <form className="login-popover" onSubmit={onLogin}>
              <label htmlFor="google-email">Gmail address</label>
              <div>
                <input
                  id="google-email"
                  type="email"
                  value={emailInput}
                  onChange={(event) => setEmailInput(event.target.value)}
                  placeholder="name@gmail.com"
                  autoComplete="email"
                />
                <button type="submit">Sign in</button>
              </div>
              <button className="create-user-entry" type="button" onClick={onOpenCreateUser}>
                Create Users
              </button>
              {authMessage && <p>{authMessage}</p>}
            </form>
          )}
        </>
      )}
    </div>
  );
}

function ContactLink({ icon, href, label, value }) {
  return (
    <a className="contact-link" href={href} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>
      <Icon name={icon} />
      <span>{label}</span>
      <strong>{value}</strong>
    </a>
  );
}

export default function GeneratedPage() {
  const allProducts = useMemo(() => [...newArrivals, ...regularItems], []);
  const [userEmail, setUserEmail] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [cartItems, setCartItems] = useState([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false);
  const [managedUsers, setManagedUsers] = useState([]);
  const [customCategories, setCustomCategories] = useState([]);
  const [selectedPayment, setSelectedPayment] = useState(paymentMethods[0].id);
  const isAdmin = userEmail.toLowerCase() === brand.adminEmail.toLowerCase();
  const invoice = useMemo(() => buildInvoice(cartItems), [cartItems]);
  const cartCount = cartItems.reduce((total, item) => total + item.quantity, 0);

  useEffect(() => {
    const savedEmail = window.localStorage.getItem("vogueEleganceUserEmail") || "";
    setUserEmail(savedEmail);
    setEmailInput(savedEmail);
    setManagedUsers(JSON.parse(window.localStorage.getItem("vogueEleganceUsers") || "[]"));
    setCustomCategories(JSON.parse(window.localStorage.getItem("vogueEleganceCategories") || "[]"));
  }, []);

  const handleCreateUser = (user) => {
    setManagedUsers((current) => {
      const next = [...current.filter((item) => item.email !== user.email), user];
      window.localStorage.setItem("vogueEleganceUsers", JSON.stringify(next));
      return next;
    });
    setCreateUserOpen(false);
    setAuthMessage(`Created user ${user.email}.`);
  };

  const handleCreateCategory = (category) => {
    setCustomCategories((current) => {
      const next = [...current.filter((item) => item.name.toLowerCase() !== category.name.toLowerCase()), category];
      window.localStorage.setItem("vogueEleganceCategories", JSON.stringify(next));
      return next;
    });
    setCreateCategoryOpen(false);
    setAuthMessage(`Created category ${category.name}.`);
  };

  const handleGoogleLogin = (event) => {
    event.preventDefault();
    const normalizedEmail = emailInput.trim().toLowerCase();

    if (!normalizedEmail.endsWith("@gmail.com")) {
      setAuthMessage("Use a Gmail address to continue.");
      return;
    }

    window.localStorage.setItem("vogueEleganceUserEmail", normalizedEmail);
    setUserEmail(normalizedEmail);
    setLoginOpen(false);
    setAuthMessage(
      normalizedEmail === brand.adminEmail.toLowerCase()
        ? "Admin access enabled."
        : "Signed in as a customer."
    );
  };

  const handleLogout = () => {
    window.localStorage.removeItem("vogueEleganceUserEmail");
    window.localStorage.removeItem("vogueEleganceAdmin");
    setUserEmail("");
    setEmailInput("");
    setLoginOpen(false);
    setAuthMessage("");
  };

  const handleAddToCart = (product) => {
    setCartItems((current) => {
      const existingItem = current.find((item) => item.id === product.id);

      if (existingItem) {
        return current.map((item) =>
          item.id === product.id
            ? { ...item, quantity: Math.min(product.stock, item.quantity + 1) }
            : item
        );
      }

      return [...current, { ...product, quantity: 1 }];
    });
  };

  const handleChangeQuantity = (productId, delta) => {
    setCartItems((current) =>
      current
        .map((item) =>
          item.id === productId
            ? { ...item, quantity: Math.min(item.stock, Math.max(0, item.quantity + delta)) }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const handleRemoveItem = (productId) => {
    setCartItems((current) => current.filter((item) => item.id !== productId));
  };

  const handleConfirmCheckout = () => {
    const method = paymentMethods.find((item) => item.id === selectedPayment)?.name || "UPI";
    setAuthMessage(`Checkout preview ready with ${method}. Invoice ${invoice.invoiceNumber} total is ${formatInr(invoice.total)}.`);
    setCheckoutOpen(false);
  };

  return (
    <main className="generated-page">
      <section className="hero-section" id="top">
        <nav className="site-nav" aria-label="Main navigation">
          <a className="brand-lockup" href="#top">
            <span className="brand-mark">VE</span>
            <span>
              <strong>{brand.name}</strong>
              <small>{brand.location}</small>
            </span>
          </a>
          <div className="nav-links">
            <a href="#new-arrivals">New arrivals</a>
            <a href="#regular-items">Regular items</a>
            <a href="#cart">Cart ({cartCount})</a>
            <a href="#contact">Contact</a>
            {isAdmin && <a href="#admin">Admin</a>}
          </div>
          <GoogleLogin
            userEmail={userEmail}
            emailInput={emailInput}
            setEmailInput={setEmailInput}
            loginOpen={loginOpen}
            setLoginOpen={setLoginOpen}
            onLogin={handleGoogleLogin}
            onLogout={handleLogout}
            onOpenCreateUser={() => setCreateUserOpen(true)}
            isAdmin={isAdmin}
            authMessage={authMessage}
          />
        </nav>

        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">{brand.eyebrow}</p>
            <h1>{brand.headline}</h1>
            <p>{brand.subhead}</p>
            <div className="hero-actions">
              <a className="button primary" href="#new-arrivals">
                Shop new arrivals
              </a>
              <a className="button secondary" href="#cart">
                <Icon name="cart" />
                View cart
              </a>
            </div>
          </div>
          <div className="hero-gallery" aria-label="Vogue Elegance bag edit">
            {heroGallery.map((item, index) => (
              <figure className={`hero-photo hero-photo-${index + 1}`} key={item.alt}>
                <img src={item.src} alt={item.alt} />
              </figure>
            ))}
            <div className="hero-note">
              <Icon name="bag" />
              <strong>Vogue Elegance edit</strong>
              <span>New-season bags, local assistance, quick enquiry.</span>
            </div>
          </div>
        </div>

        <div className="proof-strip">
          {proof.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>

      <section className="intro-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Boutique workflow</p>
            <h2>Browse by arrival status, then enquire directly with the shop.</h2>
          </div>
          <p>
            The public storefront focuses on the customer journey: curated products, clear prices,
            visible contact channels, and a direct Google Maps destination.
          </p>
        </div>
        <div className="highlight-grid">
          {serviceHighlights.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <CatalogSection
        id="new-arrivals"
        eyebrow="New arrivals"
        title="Fresh pieces from the latest arrival edit."
        intro="These cards use current arrival names, prices, sale labels, and locally saved product photos. The item source appears only as a small logo badge on each card."
        products={newArrivals}
        onAddToCart={handleAddToCart}
        cartItems={cartItems}
      />

      <CatalogSection
        id="regular-items"
        eyebrow="Regular items"
        title="Everyday bags kept separate for faster browsing."
        intro="A concise regular collection for customers who want classic totes, shoulder bags, and neutral quilted options."
        products={regularItems}
        onAddToCart={handleAddToCart}
        cartItems={cartItems}
      />

      <CartPanel
        cartItems={cartItems}
        invoice={invoice}
        onChangeQuantity={handleChangeQuantity}
        onRemoveItem={handleRemoveItem}
        onCheckout={() => setCheckoutOpen(true)}
        onClearCart={() => setCartItems([])}
      />

      <section className="materials-section" id="materials">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Materials and styling</p>
            <h2>Premium, practical, and easy to compare.</h2>
          </div>
        </div>
        <div className="highlight-grid">
          {materials.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="contact-section" id="contact">
        <div className="contact-card">
          <p className="eyebrow">Contact Vogue Elegance</p>
          <h2>{contact.name}</h2>
          <address>{contact.address}</address>
          <div className="contact-grid">
            <ContactLink icon="whatsapp" href={contact.whatsappUrl} label="WhatsApp" value={contact.whatsappDisplay} />
            <ContactLink icon="instagram" href={contact.instagramUrl} label="Instagram" value={contact.instagram} />
            <ContactLink icon="phone" href={`tel:${contact.phoneTel}`} label="Call" value={contact.phoneDisplay} />
            <ContactLink icon="mail" href={`mailto:${contact.email}`} label="Email" value={contact.email} />
            <ContactLink icon="map" href={contact.mapLink} label="Map" value="Open Google Maps" />
          </div>
        </div>

        <aside className="map-card" id="location" aria-label="Google Maps location for Vogue Elegance">
          <div className="map-toolbar">
            <span>Google Maps location</span>
            <a href={contact.mapLink} target="_blank" rel="noreferrer">
              Open map
            </a>
          </div>
          <div className="map-canvas">
            <span className="map-road road-one" />
            <span className="map-road road-two" />
            <span className="map-road road-three" />
            <span className="map-block block-one" />
            <span className="map-block block-two" />
            <span className="map-block block-three" />
            <span className="map-pin">
              <Icon name="bag" />
            </span>
          </div>
          <strong>{contact.mapLabel}</strong>
          <span>{contact.coordinates}</span>
          <p>{contact.category}</p>
        </aside>
      </section>

      <section className="cta-section">
        <div>
          <p className="eyebrow">Visit or message</p>
          <h2>Ready to check color, stock, or pickup timing?</h2>
        </div>
        <a className="button primary" href={contact.whatsappUrl} target="_blank" rel="noreferrer">
          <Icon name="whatsapp" />
          Start WhatsApp enquiry
        </a>
      </section>

      {isAdmin && (
        <AdminTable
          products={allProducts}
          users={managedUsers}
          categories={customCategories}
          onOpenCreateUser={() => setCreateUserOpen(true)}
          onOpenCreateCategory={() => setCreateCategoryOpen(true)}
        />
      )}

      {createUserOpen && <CreateUserModal onClose={() => setCreateUserOpen(false)} onCreate={handleCreateUser} />}

      {createCategoryOpen && <CreateCategoryModal onClose={() => setCreateCategoryOpen(false)} onCreate={handleCreateCategory} />}

      {checkoutOpen && cartItems.length > 0 && (
        <CheckoutModal
          cartItems={cartItems}
          invoice={invoice}
          selectedPayment={selectedPayment}
          setSelectedPayment={setSelectedPayment}
          onClose={() => setCheckoutOpen(false)}
          onConfirm={handleConfirmCheckout}
        />
      )}
    </main>
  );
}

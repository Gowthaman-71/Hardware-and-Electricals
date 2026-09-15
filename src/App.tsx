type ImportError = { row: number; sku: string; field: string; message: string };
function DynamicCategoryManager({
  categories,
  setCategories,
  products,
  notify,
}: {
  categories: Category[];
  setCategories: (items: Category[]) => void;
  products: Product[];
  notify: (message: string) => void;
}) {
  void LegacyAdminCategories;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [editing, setEditing] = useState<Category | null>(null);
  const [attributeName, setAttributeName] = useState("");
  const [attributeType, setAttributeType] = useState<AttributeType>("Dropdown");
  const [attributeValue, setAttributeValue] = useState("");
  const apiToken = sessionStorage.getItem("murugesan-auth-token") || "";
  const visible = categories.filter(
    (category) =>
      category.name.toLowerCase().includes(search.toLowerCase()) &&
      (status === "All" ||
        (status === "Archived" && category.status === "ARCHIVED") ||
        (status === "Active" && category.status !== "ARCHIVED" && category.active !== false) ||
        (status === "Inactive" && category.status !== "ARCHIVED" && category.active === false)),
  );
  const update = async (category: Category) => {
    const response = await fetch(`/api/categories/${category.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        name: category.name,
        slug: category.slug,
        parentId: category.parentId || null,
        imageUrl: category.image || null,
        description: category.description,
        status: category.active === false ? "INACTIVE" : "ACTIVE",
        sortOrder: category.order || 0,
        attributes: category.attributes || [],
      }),
    });
    if (!response.ok) return notify("Unable to update category");
    const saved = (await response.json()) as Category;
    setCategories(
      categories.map((item) => (item.id === saved.id ? saved : item)),
    );
    notify("Category updated");
  };
  const upload = async (file?: File) => {
    if (!file || !editing) return;
    const form = new FormData();
    form.append("image", file);
    const response = await fetch("/api/images", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` },
      body: form,
    });
    if (!response.ok) return notify("Unable to upload category image");
    const result = (await response.json()) as { url: string };
    setEditing({ ...editing, image: result.url });
    notify("Category image uploaded");
  };
  const addAttribute = () => {
    if (!editing || !attributeName.trim()) return;
    const values = ["Dropdown", "Multi-select", "Radio Button"].includes(
      attributeType,
    )
      ? attributeValue
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
    setEditing({
      ...editing,
      attributes: [
        ...(editing.attributes || []),
        {
          id: Date.now(),
          name: attributeName.trim(),
          type: attributeType,
          values,
        },
      ],
    });
    setAttributeName("");
    setAttributeValue("");
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing?.name.trim()) return;
    const isNewCategory = !editing.id || editing.id === 0;
    const normalizedName = editing.name.trim();
    const normalizedSlug = editing.slug?.trim() || normalizedName;
    const payload = {
      name: normalizedName,
      slug: normalizedSlug,
      parentId: editing.parentId || null,
      imageUrl: editing.image || null,
      description: editing.description || "",
      status: editing.active === false ? "INACTIVE" : "ACTIVE",
      sortOrder: editing.order || categories.length + 1,
      attributes: editing.attributes || [],
    };
    const response = await fetch(
      isNewCategory ? "/api/categories" : `/api/categories/${editing.id}`,
      {
        method: isNewCategory ? "POST" : "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) return notify("Unable to save category");
    const category = (await response.json()) as Category;
    setCategories(
      categories.some((item) => item.id === category.id)
        ? categories.map((item) => (item.id === category.id ? category : item))
        : [...categories, category],
    );
    setEditing(null);
    notify("Category saved");
  };
  const remove = async (category: Category) => {
    const count = products.filter(
      (product) =>
        product.categoryId === category.id ||
        product.category === category.name,
    ).length;
    if (
      !window.confirm(
        `${count ? `Archive ${category.name}?\n\nThis category contains ${count} product${count === 1 ? "" : "s"}.` : `Delete ${category.name}?`}\n\nThis action cannot be undone.`,
      )
    )
      return;
    const response = await fetchWithTimeout(`/api/categories/${category.id}/archive`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!response.ok) return notify("Unable to archive category");
    const result = await response.json();
    // Backend returns {archived: true, ...} or {deleted: true, ...}
    if (result.archived) {
      // Category was archived (has products) - refresh from server to get updated status
      const refreshed = await fetchWithTimeout(`/api/categories`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (refreshed.ok) {
        const allCategories = await refreshed.json();
        setCategories(allCategories);
      }
      notify("Category archived (contains products)");
    } else if (result.deleted) {
      setCategories(categories.filter((item) => item.id !== category.id));
      notify("Category deleted");
    }
  };
  return (
    <>
      <div className="admin-topline">
        <div>
          <p className="eyebrow">CATALOGUE / ORGANISE</p>
          <h1>
            Categories <span className="count-badge">{categories.length}</span>
          </h1>
          <p>
            Manage hierarchy, images, status and category-specific attributes.
          </p>
        </div>
        <button
          className="button blue"
          onClick={() =>
            setEditing({
              id: 0,
              name: "",
              description: "",
              parentId: null,
              active: true,
              slug: "",
              order: categories.length + 1,
              attributes: [],
            })
          }
        >
          + Add Category
        </button>
      </div>
      <div className="table-toolbar">
        <label className="search">
          <span>⌕</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search categories"
          />
        </label>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option>All</option>
          <option>Active</option>
          <option>Inactive</option>
          <option>Archived</option>
        </select>
      </div>
      <div className="category-admin-grid">
        {visible.map((category) => (
          <div className="category-admin-card" key={category.id}>
            {category.image ? (
              <img src={category.image} alt="" />
            ) : (
              <span>◇</span>
            )}
            <strong>
              {category.name}
              {category.status === "ARCHIVED" && <em style={{marginLeft: "8px", color: "#999", fontSize: "0.85em", fontStyle: "normal"}}>(Archived)</em>}
            </strong>
            <small>
              {category.parentId
                ? `Under ${categories.find((item) => item.id === category.parentId)?.name || "category"}`
                : "Top-level"}{" "}
              ·{" "}
              {
                products.filter((product) => product.category === category.name)
                  .length
              }{" "}
              products
            </small>
            <small>
              {category.status === "ARCHIVED" ? "Archived" : category.active === false ? "Inactive" : "Active"} ·{" "}
              {category.attributes?.length || 0} attributes
            </small>
            <div>
              {category.status === "ARCHIVED" ? (
                <button onClick={async () => {
                  const response = await fetch(`/api/categories/${category.id}/restore`, {
                    method: "PATCH",
                    headers: { Authorization: `Bearer ${apiToken}` },
                  });
                  if (!response.ok) return notify("Unable to restore category");
                  const restored = (await response.json()) as Category;
                  setCategories(categories.map(item => item.id === restored.id ? restored : item));
                  notify("Category restored");
                }}>Restore</button>
              ) : (
                <>
                  <button onClick={() => setEditing(category)}>Edit</button>
                  <button
                    onClick={() =>
                      update({ ...category, active: category.active === false })
                    }
                  >
                    {category.active === false ? "Enable" : "Disable"}
                  </button>
                  <button onClick={() => remove(category)}>Delete</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <div className="form-overlay">
          <form className="product-form category-form" onSubmit={save}>
            <div className="form-heading">
              <div>
                <p className="eyebrow">CATEGORY MANAGEMENT</p>
                <h2>{editing.name ? "Edit Category" : "Add Category"}</h2>
              </div>
              <button type="button" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>
            <label className="dropzone">
              {editing.image && (
                <img src={editing.image} alt="Category preview" />
              )}
              <strong>
                {editing.image
                  ? "Replace Category Image"
                  : "Upload Category Image"}
              </strong>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => upload(event.target.files?.[0])}
              />
            </label>
            <div className="form-grid">
              <label>
                Category Name *
                <input
                  required
                  value={editing.name}
                  onChange={(event) =>
                    setEditing({ ...editing, name: event.target.value })
                  }
                />
              </label>
              <label>
                Parent Category
                <select
                  value={editing.parentId || ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      parentId: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                >
                  <option value="">None</option>
                  {categories
                    .filter((category) => category.id !== editing.id)
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                URL Slug
                <input
                  value={editing.slug || ""}
                  onChange={(event) =>
                    setEditing({ ...editing, slug: event.target.value })
                  }
                />
              </label>
              <label>
                Status
                <select
                  value={editing.active === false ? "Inactive" : "Active"}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      active: event.target.value === "Active",
                    })
                  }
                >
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              </label>
              <label>
                Description
                <textarea
                  value={editing.description}
                  onChange={(event) =>
                    setEditing({ ...editing, description: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="attribute-builder">
              <div className="panel-heading">
                <h2>Manage Attributes</h2>
                <small>
                  Configure fields shown for products in this category.
                </small>
              </div>
              {(editing.attributes || []).map((attribute) => (
                <div className="attribute-row" key={attribute.id}>
                  <strong>{attribute.name}</strong>
                  <span>
                    {attribute.type}
                    {attribute.values.length
                      ? ` · ${attribute.values.join(", ")}`
                      : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        ...editing,
                        attributes: editing.attributes?.filter(
                          (item) => item.id !== attribute.id,
                        ),
                      })
                    }
                  >
                    Delete
                  </button>
                </div>
              ))}
              <div className="attribute-add">
                <input
                  value={attributeName}
                  onChange={(event) => setAttributeName(event.target.value)}
                  placeholder="Attribute name"
                />
                <select
                  value={attributeType}
                  onChange={(event) =>
                    setAttributeType(event.target.value as AttributeType)
                  }
                >
                  {[
                    "Dropdown",
                    "Multi-select",
                    "Text",
                    "Number",
                    "Number Range",
                    "Boolean / Yes-No",
                    "Color",
                    "Image",
                    "Radio Button",
                  ].map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
                <input
                  value={attributeValue}
                  onChange={(event) => setAttributeValue(event.target.value)}
                  placeholder="Values, comma separated"
                  disabled={
                    !["Dropdown", "Multi-select", "Radio Button"].includes(
                      attributeType,
                    )
                  }
                />
                <button type="button" onClick={addAttribute}>
                  + Add Attribute
                </button>
              </div>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="text-button"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button className="button blue" type="submit">
                Save Category
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
function AdminExtras({
  products,
  onAdd,
}: {
  products: Product[];
  onAdd: () => void;
}) {
  const lowStock = products.filter(
    (product) => product.stock > 0 && product.stock < 10,
  );
  return (
    <>
      <div className="admin-dashboard-grid">
        <section className="admin-panel sales-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SALES OVERVIEW</p>
              <h2>Store activity</h2>
            </div>
            <select>
              <option>This month</option>
            </select>
          </div>
          <svg
            viewBox="0 0 600 180"
            role="img"
            aria-label="Sales overview chart"
          >
            <path
              d="M0 142 C55 112 74 134 122 98 S187 117 235 79 S303 111 345 69 S418 96 457 45 S520 76 600 24"
              fill="none"
              stroke="#874777"
              strokeWidth="4"
            />
            <path
              d="M0 142 C55 112 74 134 122 98 S187 117 235 79 S303 111 345 69 S418 96 457 45 S520 76 600 24 V180 H0Z"
              fill="#874777"
              opacity=".1"
            />
          </svg>
          <div className="chart-legend">
            <span>
              Total sales <b>₹4,82,750</b>
            </span>
            <span>
              Average order <b>₹1,547</b>
            </span>
            <span>
              Customers <b>268</b>
            </span>
          </div>
        </section>
        <section className="admin-panel date-panel">
          <p className="eyebrow">TODAY'S DATE</p>
          <strong>03 Sep 2026</strong>
          <span>Thursday</span>
          <b>▣</b>
        </section>
        <section className="admin-panel enquiry-panel">
          <div className="panel-heading">
            <h2>Recent enquiries</h2>
            <button className="text-button">View all ↗</button>
          </div>
          {[
            "Siva Electricals",
            "R.K. Enterprises",
            "Kumar Traders",
            "Maha Electricals",
          ].map((name, index) => (
            <div className="enquiry-row" key={name}>
              <span>#{1052 - index}</span>
              <strong>{name}</strong>
              <i
                className={
                  index === 1 ? "processing" : index === 2 ? "pending" : ""
                }
              >
                {index === 1 ? "Processing" : index === 2 ? "Pending" : "New"}
              </i>
              <b>{money([2850, 1450, 3220, 4780][index])}</b>
            </div>
          ))}
        </section>
        <section className="admin-panel stock-panel">
          <div className="panel-heading">
            <h2>Low stock alerts</h2>
            <button className="text-button">View all ↗</button>
          </div>
          {(lowStock.length ? lowStock : products.slice(0, 4)).map(
            (product) => (
              <div className="stock-row" key={product.id}>
                <span>{product.name}</span>
                <small>{product.code}</small>
                <b>{product.stock}</b>
              </div>
            ),
          )}
        </section>
      </div>
      <div className="quick-actions">
        <button onClick={onAdd}>＋ Add Product</button>
        <button>▦ Manage Categories</button>
        <button>▣ View Orders</button>
        <button>▣ Inventory Report</button>
        <button>◇ Add Offer</button>
      </div>
    </>
  );
}
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import * as XLSX from "xlsx";
import "./App.css";
import "./motion.css";
import "./admin-theme.css";
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

type AttributeType =
  | "Dropdown"
  | "Multi-select"
  | "Text"
  | "Number"
  | "Number Range"
  | "Boolean / Yes-No"
  | "Color"
  | "Image"
  | "Radio Button";
type CategoryAttribute = {
  id: number;
  name: string;
  type: AttributeType;
  values: string[];
};
type Product = {
  id: number;
  name: string;
  code: string;
  category: string;
  categoryId?: number;
  brand: string;
  price: number;
  mrp: number;
  stock: number;
  unit: string;
  image: string;
  description: string;
  details: string;
  attributes?: Record<string, string | string[]>;
  status?: "Active" | "Inactive";
};
type Category = {
  id: number;
  name: string;
  description: string;
  parentId?: number | null;
  image?: string;
  active?: boolean;
  slug?: string;
  createdAt?: string;
  order?: number;
  brands?: string[];
  types?: string[];
  attributes?: CategoryAttribute[];
  status?: "ACTIVE" | "INACTIVE" | "ARCHIVED";
};
type Screen =
  | "home"
  | "products"
  | "detail"
  | "cart"
  | "login"
  | "customer-login"
  | "account"
  | "admin";
type Customer = { id: number; name: string; email: string; mobile: string };
type Address = {
  id: number;
  type: string;
  fullName: string;
  phone: string;
  gstNumber?: string | null;
  addressLine1: string;
  addressLine2: string;
  area: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
};
type CustomerOrder = {
  id: number;
  orderNumber: string;
  customerId?: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  gstNumber?: string | null;
  items: {
    productId?: number;
    productName?: string;
    name?: string;
    productImage?: string;
    image?: string;
    quantity: number;
    price: number;
    unitPrice?: number;
    totalPrice?: number;
  }[];
  subtotal?: number;
  deliveryCharge?: number;
  total: number;
  status: string;
  paymentStatus?: string;
  paymentMethod?: string;
  deliveryAddress: Address | Record<string, unknown>;
  statusHistory?: {
    id: number;
    status: string;
    changedBy?: number | null;
    createdAt: string;
    note?: string;
  }[];
  createdAt: string;
  itemCount?: number;
  notification?: { sent?: boolean; prepared?: boolean; error?: string | null; whatsappUrl?: string | null } | null;
};
const orderStatusTimeline = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;
const orderStatusIndex = (status: string) =>
  orderStatusTimeline.indexOf(status as (typeof orderStatusTimeline)[number]);
const nextOrderStatuses: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "REJECTED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  REJECTED: [],
  PROCESSING: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};
const formatOrderStatus = (status: string) => {
  const value = String(status || "PENDING").trim().toUpperCase();
  const map: Record<string, string> = {
    PENDING: "Pending",
    CONFIRMED: "Confirmed",
    REJECTED: "Rejected",
    PROCESSING: "Processing",
    OUT_FOR_DELIVERY: "Out for Delivery",
    DELIVERED: "Delivered",
    CANCELLED: "Cancelled",
  };
  return map[value] || value.replace(/_/g, " ");
};
const orderAddressText = (value: Address | Record<string, unknown>) => {
  const address = value && typeof value === "object" ? value : {};
  const parts = ["addressLine1", "area", "city", "state"]
    .map((key) => String(address[key as keyof typeof address] || "").trim())
    .filter(Boolean);
  const pincode = String(address.pincode || "").trim();
  return pincode ? `${parts.join(", ")}${parts.length ? " - " : ""}${pincode}` : parts.join(", ");
};
const normalizeWhatsAppNumber = (value: unknown): string => {
  if (!value) return "";
  let digits = String(value).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length > 12) return digits.slice(-12);
  if (digits.length >= 10) return `91${digits.slice(-10)}`;
  return digits;
};
const isValidWhatsAppNumber = (value: unknown): boolean => {
  const normalized = normalizeWhatsAppNumber(value);
  if (!normalized) return false;
  const digitsOnly = normalized.replace(/\D/g, "");
  if (digitsOnly.length < 12) return false;
  const localPart = digitsOnly.length === 12 ? digitsOnly.slice(2) : digitsOnly.slice(-10);
  return /^[6-9]/.test(localPart);
};
const buildWhatsAppUrl = (phoneNumber: unknown, message: unknown): string => {
  const normalized = normalizeWhatsAppNumber(phoneNumber);
  if (!normalized || !message) return "";
  return `https://wa.me/${normalized}?text=${encodeURIComponent(String(message))}`;
};
const openWhatsAppUrl = (url: string): boolean => {
  if (!url) return false;

  try {
    const target = String(url).trim();
    if (!target) return false;

    // Use window.location.assign for same-tab navigation to avoid popup blockers
    window.location.assign(target);
    return true;
  } catch {
    try {
      // Fallback to window.open if assign fails
      window.open(url, "_blank", "noopener,noreferrer");
      return true;
    } catch {
      return false;
    }
  }
};
const logoPath = "/assets/logo/murugesan-logo.png";
const fallbackImage =
  "https://images.unsplash.com/photo-1621905252507-b35492cc74b4?auto=format&fit=crop&w=900&q=80";
const businessWhatsappNumber = normalizeWhatsAppNumber(
  import.meta.env.VITE_BUSINESS_WHATSAPP_NUMBER || import.meta.env.BUSINESS_WHATSAPP_NUMBER || "919361866771",
);
const image = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=82`;
const money = (value: number) => `₹${value.toLocaleString("en-IN")}`;
const normalizeProductStock = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : 0;
};
const statusOf = (stock: number) =>
  stock === 0 ? "Out of stock" : stock < 10 ? "Low stock" : "In stock";

// Global fetch with timeout helper
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function loadCatalog(): Promise<{
  products: Product[];
  categories: Category[];
}> {
  const response = await fetchWithTimeout("/api/catalog", { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to load catalog");
  return response.json();
}
async function loadAllCategories(token: string): Promise<Category[]> {
  const response = await fetchWithTimeout("/api/categories", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Unable to load categories");
  return response.json();
}
async function loginRequest(
  mobile: string,
  password: string,
): Promise<{ token: string }> {
  const response = await fetchWithTimeout("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: mobile.replace(/\D/g, ""), password }),
  });
  if (!response.ok) throw new Error("Invalid credentials");
  return response.json();
}
async function saveProductRequest(
  token: string,
  product: Product,
  categories: Category[],
): Promise<Product> {
  console.log('[saveProductRequest] Starting save with:', { product, categories });
  
  // Filter to only ACTIVE categories for product assignment
  const activeCategories = categories.filter(c => c.status !== "ARCHIVED" && c.active !== false);
  console.log('[saveProductRequest] Active categories:', activeCategories);
  
  const categoryId = product.categoryId || activeCategories.find((item) => item.name === product.category)?.id;
  console.log('[saveProductRequest] Found categoryId:', categoryId, 'for category:', product.category);
  
  if (!product.code.trim()) throw new Error("Product code is required");
  if (!product.name.trim()) throw new Error("Product name is required");
  if (!categoryId) {
    console.error('[saveProductRequest] Category not found! Available categories:', activeCategories.map(c => c.name));
    throw new Error(`Category "${product.category}" not found. Please select a valid category.`);
  }
  
  const sanitizedStock = normalizeProductStock(product.stock);
  
  const requestBody = { 
    sku: product.code.trim(), 
    name: product.name.trim(), 
    categoryId, 
    brand: product.brand || '', 
    description: product.description || '', 
    details: product.details || '', 
    price: product.price, 
    mrp: product.mrp || product.price, 
    stock: sanitizedStock, 
    unit: product.unit, 
    imageUrl: product.image || null, 
    attributes: product.attributes || {}, 
    status: product.status === "Inactive" ? "INACTIVE" : "ACTIVE" 
  };
  
  console.log('[saveProductRequest] Sending request to API:', requestBody);
  
  try {
    const response = await fetchWithTimeout(product.id ? `/api/products/${product.id}` : "/api/products", {
      method: product.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(requestBody),
    });
    
    console.log('[saveProductRequest] Response status:', response.status);
    
    const result = await response.json().catch(() => ({}));
    console.log('[saveProductRequest] Response body:', result);
    
    if (!response.ok) {
      const errorMsg = result.error || result.message || "Unable to save product";
      console.error('[saveProductRequest] API error:', errorMsg, result);
      throw new Error(errorMsg);
    }
    
    console.log('[saveProductRequest] Product saved successfully:', result);
    return result as Product;
  } catch (error) {
    console.error('[saveProductRequest] Request failed:', error);
    throw error;
  }
}
async function saveProductStockRequest(
  token: string,
  productId: number,
  stock: number,
): Promise<Product> {
  const response = await fetchWithTimeout(`/api/products/${productId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ stock }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Unable to update stock");
  return result as Product;
}
function Logo({ compact = false }: { compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`logo-lockup ${compact ? "compact" : ""}`}>
      {failed ? (
        <span className="brand-fallback">
          <b>M</b>
        </span>
      ) : (
        <img
          className="logo"
          src={logoPath}
          alt="Murugesan Electrical and Hardwares"
          onError={() => setFailed(true)}
        />
      )}
      <span className="logo-name">
        MURUGESAN ELECTRICAL AND HARDWARES<small>TIRUPATHUR</small>
      </span>
    </span>
  );
}
function BrandIntro({ onSkip }: { onSkip: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onSkip, 2600);
    return () => window.clearTimeout(timer);
  }, [onSkip]);
  return (
    <div className="brand-intro">
      <div className="intro-grid" />
      <div className="intro-sweep" />
      <div className="intro-content">
        <img src={logoPath} alt="Murugesan Electrical and Hardwares" />
        <p>MURUGESAN</p>
        <span>ELECTRICAL AND HARDWARES</span>
        <small>TIRUPATHUR</small>
      </div>
      <button className="skip-intro" onClick={onSkip}>
        Skip intro
      </button>
    </div>
  );
}
function App() {
  const [intro, setIntro] = useState(() => {
    try {
      return sessionStorage.getItem("murugesan-intro-seen") !== "true";
    } catch {
      return true;
    }
  });
  const readStoredToken = (key: string) => {
    try {
      return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
    } catch {
      return "";
    }
  };
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [screen, setScreenState] = useState<Screen>("home");
  const [adminView, setAdminView] = useState("Dashboard");
  const [selected, setSelected] = useState<Product | null>(null);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [cart, setCart] = useState<{ product: Product; quantity: number }[]>([]);
  
  // Initialize cart from localStorage after products are loaded
  useEffect(() => {
    if (products.length === 0) return;
    
    try {
      const stored = localStorage.getItem("murugesan-cart");
      if (!stored) return;
      
      const minimalCart = JSON.parse(stored);
      if (!Array.isArray(minimalCart)) return;
      
      // Restore full cart by matching product IDs
      const restoredCart = minimalCart
        .map((item: any) => {
          const product = products.find(p => p.id === item.productId);
          return product ? { product, quantity: item.quantity || 1 } : null;
        })
        .filter((item): item is { product: Product; quantity: number } => item !== null);
      
      if (restoredCart.length > 0) {
        setCart(restoredCart);
      }
    } catch (error) {
      console.error('[Cart] Failed to restore from localStorage:', error);
      localStorage.removeItem("murugesan-cart");
    }
  }, [products]);
  const [editing, setEditing] = useState<Product | null>(null);
  const [authToken, setAuthToken] = useState(() => readStoredToken("murugesan-auth-token"));
  const [customerToken, setCustomerToken] = useState(() => readStoredToken("murugesan-customer-token"));
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [toast, setToast] = useState("");
  const setScreen = (next: Screen) => {
    setScreenState(next);
    window.history.pushState({ screen: next }, "", window.location.pathname);
  };
  useEffect(() => {
    const handleBack = () => setScreenState(window.history.state?.screen || "home");
    window.history.replaceState({ screen: "home" }, "", window.location.pathname);
    window.addEventListener("popstate", handleBack);
    return () => window.removeEventListener("popstate", handleBack);
  }, []);
  useEffect(() => {
    try {
      // Only save minimal cart data (id and quantity) to avoid localStorage quota
      const minimalCart = cart.map(item => ({
        productId: item.product.id,
        quantity: item.quantity
      }));
      localStorage.setItem("murugesan-cart", JSON.stringify(minimalCart));
    } catch (error) {
      console.error('[Cart] Failed to save to localStorage:', error);
      // If quota exceeded, clear cart from localStorage
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        try {
          localStorage.removeItem("murugesan-cart");
          console.warn('[Cart] Cleared cart from localStorage due to quota exceeded');
        } catch {
          // Ignore
        }
      }
    }
  }, [cart]);
  useEffect(() => {
    let mounted = true;
    const refreshCatalog = async () => {
      try {
        const catalog = await loadCatalog();
        if (!mounted) return;
        setProducts(catalog.products);
        setCategories(catalog.categories);
        setCatalogError("");
      } catch {
        if (mounted) {
          setCatalogError("Unable to load the live catalog. Please try again.");
        }
      }
    };
    void refreshCatalog();
    // Removed: aggressive auto-refresh causing performance issues
    // Only refresh on initial mount - admin can manually refresh if needed
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const restoreCustomerSession = async () => {
      const storedToken = readStoredToken("murugesan-customer-token");
      if (!storedToken) return;
      try {
        const response = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${storedToken}` },
        });
        if (!response.ok) {
          localStorage.removeItem("murugesan-customer-token");
          sessionStorage.removeItem("murugesan-customer-token");
          return;
        }
        const profile = (await response.json()) as Customer;
        if (!active) return;
        setCustomerToken(storedToken);
        setCustomer(profile);
      } catch {
        localStorage.removeItem("murugesan-customer-token");
        sessionStorage.removeItem("murugesan-customer-token");
      }
    };
    void restoreCustomerSession();
    return () => {
      active = false;
    };
  }, []);
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2500);
  };
  const shown = useMemo(
    () =>
      products.filter(
        (p) =>
          `${p.name} ${p.code} ${p.brand} ${p.category} ${p.description} ${p.details}`
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (activeCategory === "All" || p.category === activeCategory),
      ),
    [products, query, activeCategory],
  );
  const openProduct = (product: Product) => {
    setSelected(product);
    setScreen("detail");
    window.scrollTo({ top: 0 });
  };
  const addToCart = (product: Product) => {
    try {
      console.log('[addToCart] Adding product:', product);
      
      if (!product) {
        console.error('[addToCart] Product is null or undefined');
        notify("Unable to add to cart");
        return;
      }
      
      if (!product.stock || product.stock <= 0) {
        console.log('[addToCart] Product out of stock:', product.stock);
        notify("This product is currently out of stock");
        return;
      }
      
      console.log('[addToCart] Current cart:', cart);
      
      setCart((items) => {
        const current = items.find((item) => item.product.id === product.id);
        const nextCart = current
          ? items.map((item) =>
              item.product.id === product.id
                ? { ...item, quantity: item.quantity + 1 }
                : item,
            )
          : [...items, { product, quantity: 1 }];
        
        console.log('[addToCart] Updated cart:', nextCart);
        return nextCart;
      });
      
      notify("Added to cart");
      console.log('[addToCart] Success!');
    } catch (error) {
      console.error('[addToCart] Error:', error);
      notify("Unable to add to cart. Please try again.");
    }
  };
  const setCartQuantity = (product: Product, quantity: number) => {
    if (!product.stock) return;
    
    // If quantity is 0 or less, remove item from cart
    if (quantity <= 0) {
      setCart((items) => items.filter((item) => item.product.id !== product.id));
      return;
    }
    
    // Otherwise, update quantity (cap at stock level)
    const nextQuantity = Math.min(product.stock, Math.floor(quantity) || 1);
    setCart((items) =>
      items.map((item) =>
        item.product.id === product.id
          ? { ...item, quantity: nextQuantity }
          : item,
      ),
    );
  };
  const goProducts = (cat = "All") => {
    setActiveCategory(cat);
    setScreen("products");
    window.scrollTo({ top: 0 });
  };
  const goHomeSection = (section: "categories" | "about" | "contact") => {
    setScreen("home");
    setQuery("");
    window.setTimeout(
      () =>
        document
          .getElementById(section)
          ?.scrollIntoView({ behavior: "smooth" }),
      0,
    );
  };
  const skipIntro = () => {
    try {
      sessionStorage.setItem("murugesan-intro-seen", "true");
    } catch {
      /* session storage may be unavailable */
    }
    setIntro(false);
  };
  if (intro) return <BrandIntro onSkip={skipIntro} />;
  return (
    <div className={screen === "admin" ? "app admin-mode" : "app"}>
      {catalogError && screen !== "admin" && (
        <div className="toast">{catalogError}</div>
      )}
      {screen !== "admin" && (
        <Header
          query={query}
          setQuery={setQuery}
          cartCount={cart.reduce((total, item) => total + item.quantity, 0)}
          onHome={() => {
            setScreen("home");
            setQuery("");
            window.scrollTo({ top: 0 });
          }}
          onProducts={() => goProducts()}
          onCategories={() => goHomeSection("categories")}
          onAbout={() => goHomeSection("about")}
          onContact={() => goHomeSection("contact")}
          onCart={() => setScreen("cart")}
          onLogin={() =>
            setScreen(customerToken ? "account" : "customer-login")
          }
        />
      )}
      {screen === "home" && (
        <Home
          categories={categories.filter(
            (category) => category.active !== false,
          )}
          products={products}
          cart={cart}
          onCategory={goProducts}
          onProducts={() => goProducts()}
          onProduct={openProduct}
          addToCart={addToCart}
          setCartQuantity={setCartQuantity}
          onContact={() => notify("Call Murugesan on 9361866771")}
        />
      )}
      {screen === "products" && (
        <ProductsPage
          products={shown}
          categories={categories}
          query={query}
          setQuery={setQuery}
          activeCategory={activeCategory}
          setCategory={setActiveCategory}
          cart={cart}
          onProduct={openProduct}
          addToCart={addToCart}
          setCartQuantity={setCartQuantity}
        />
      )}
      {screen === "detail" && selected && (
        <Detail
          product={selected}
          related={products
            .filter(
              (p) => p.category === selected.category && p.id !== selected.id,
            )
            .slice(0, 3)}
          cart={cart}
          quantity={
            cart.find((item) => item.product.id === selected.id)?.quantity || 0
          }
          onBack={() => goProducts(selected.category)}
          onProduct={openProduct}
          addToCart={addToCart}
          setCartQuantity={setCartQuantity}
        />
      )}
      {screen === "cart" && (
        <Cart
          items={cart}
          setCart={setCart}
          customerToken={customerToken}
          customer={customer}
          onCustomerLogin={() => setScreen("customer-login")}
          onOpenAccount={() => setScreen("account")}
          onProducts={() => goProducts()}
          onNotify={notify}
        />
      )}
      {screen === "login" && (
        <Login
          onLogin={async (mobile, password) => {
            const result = await loginRequest(mobile, password);
            setAuthToken(result.token);
            localStorage.setItem("murugesan-auth-token", result.token);
            sessionStorage.setItem("murugesan-auth-token", result.token);
            setScreen("admin");
          }}
        />
      )}
      {screen === "customer-login" && (
        <CustomerLogin
          onLogin={(result) => {
            setCustomerToken(result.token);
            setCustomer(result.user);
            localStorage.setItem("murugesan-customer-token", result.token);
            sessionStorage.setItem("murugesan-customer-token", result.token);
            setScreen("account");
          }}
          onAdmin={() => setScreen("login")}
        />
      )}
      {screen === "account" && customerToken && (
        <Account
          token={customerToken}
          customer={customer}
          setCustomer={setCustomer}
          onLogout={() => {
            setCustomerToken("");
            setCustomer(null);
            localStorage.removeItem("murugesan-customer-token");
            sessionStorage.removeItem("murugesan-customer-token");
            setScreen("home");
          }}
        />
      )}
      {screen === "admin" && authToken && (
        <Admin
          view={adminView}
          setView={setAdminView}
          products={products}
          categories={categories}
          setProducts={setProducts}
          setCategories={setCategories}
          editing={editing}
          setEditing={setEditing}
          notify={notify}
          onStore={() => setScreen("home")}
          onLogout={() => {
            setAuthToken("");
            localStorage.removeItem("murugesan-auth-token");
            sessionStorage.removeItem("murugesan-auth-token");
            setScreen("home");
          }}
        />
      )}
      {screen !== "admin" && (
        <FloatingCartButton
          itemCount={cart.reduce((total, item) => total + item.quantity, 0)}
          onCart={() => {
            setScreen("cart");
            window.scrollTo({ top: 0 });
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
function FloatingCartButton({
  itemCount,
  onCart,
}: {
  itemCount: number;
  onCart: () => void;
}) {
  if (itemCount === 0) return null;
  return (
    <button
      className="floating-cart-button"
      type="button"
      aria-label={`Open cart with ${itemCount} item${itemCount === 1 ? "" : "s"}`}
      onClick={onCart}
    >
      <span aria-hidden="true">🛒</span>
      <b>{itemCount}</b>
    </button>
  );
}
function Header({
  query,
  setQuery,
  cartCount,
  onHome,
  onProducts,
  onCategories,
  onAbout,
  onContact,
  onCart,
  onLogin,
}: {
  query: string;
  setQuery: (value: string) => void;
  cartCount: number;
  onHome: () => void;
  onProducts: () => void;
  onCategories: () => void;
  onAbout: () => void;
  onContact: () => void;
  onCart: () => void;
  onLogin: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = (action: () => void) => {
    setMenuOpen(false);
    action();
  };
  return (
    <header className={`site-header${menuOpen ? " menu-open" : ""}`}>
      <button className="logo-button" onClick={() => navigate(onHome)}>
        <Logo />
      </button>
      <nav>
        <button onClick={() => navigate(onHome)}>Home</button>
        <button onClick={() => navigate(onProducts)}>Products</button>
        <button onClick={() => navigate(onCategories)}>Categories</button>
        <button onClick={() => navigate(onAbout)}>About</button>
        <button onClick={() => navigate(onContact)}>Contact</button>
      </nav>
      <div className="header-tools">
        <label className="search">
          <span>⌕</span>
          <input
            aria-label="Search products"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products..."
          />
        </label>
        <button className="header-cart" onClick={() => navigate(onCart)}>
          Cart <b>{cartCount.toString().padStart(2, "0")}</b>
        </button>
        <button className="login-link" onClick={() => navigate(onLogin)}>
          Login ↗
        </button>
        <button
          className="mobile-menu-button"
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? "×" : "☰"}
        </button>
      </div>
      {menuOpen && (
        <div className="mobile-nav">
          <button onClick={() => navigate(onHome)}>Home</button>
          <button onClick={() => navigate(onProducts)}>Products</button>
          <button onClick={() => navigate(onCategories)}>Categories</button>
          <button onClick={() => navigate(onAbout)}>About</button>
          <button onClick={() => navigate(onContact)}>Contact</button>
        </div>
      )}
    </header>
  );
}
function Home({
  categories,
  products,
  cart,
  onCategory,
  onProducts,
  onProduct,
  addToCart,
  setCartQuantity,
  onContact,
}: {
  categories: Category[];
  products: Product[];
  cart: { product: Product; quantity: number }[];
  onCategory: (cat: string) => void;
  onProducts: () => void;
  onProduct: (p: Product) => void;
  addToCart: (p: Product) => void;
  setCartQuantity: (p: Product, quantity: number) => void;
  onContact: () => void;
}) {
  const categoryImages = [
    image("photo-1558008258-3256797b43f3"),
    image("photo-1558618666-fcd25c85cd64"),
    image("photo-1621905252507-b35492cc74b4"),
    image("photo-1535813547-99c9c7c41d4d"),
    image("photo-1504148455328-c376907d081c"),
    image("photo-1586864387967-d02ef85d93e8"),
  ];
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            MURUGESAN ELECTRICAL AND HARDWARES / TIRUPATHUR
          </p>
          <h1>
            Everything Electrical & Hardware, <em>Under One Roof</em>
          </h1>
          <p className="hero-lede">
            Quality electrical products, hardware essentials and trusted service
            from Murugesan Electrical and Hardwares, Tirupathur.
          </p>
          <div className="hero-actions">
            <button className="button dark" onClick={onProducts}>
              Explore products ↘
            </button>
            <button className="plain-button" onClick={onContact}>
              Contact us ↗
            </button>
          </div>
          <div className="trust-line">
            <span>Genuine brands</span>
            <span>Trade-ready pricing</span>
            <span>Local service</span>
          </div>
        </div>
        <div className="hero-visual">
          <img
            src={image("photo-1586864387967-d02ef85d93e8")}
            alt="Electrical and hardware supplies"
          />
          <div className="visual-label">
            TRUSTED LOCAL SUPPLY
            <br />
            <b>TIRUPATHUR</b>
          </div>
        </div>
      </section>
      <section className="category-section" id="categories">
        <div className="section-heading">
          <div>
            <p className="eyebrow">01 / SHOP BY CATEGORY</p>
            <h2>
              Find your next <em>essential.</em>
            </h2>
          </div>
          <button className="text-button" onClick={onProducts}>
            View all products ↗
          </button>
        </div>
        <div className="category-grid">
          {categories.slice(0, 6).map((category, index) => (
            <button
              className="category-card"
              key={category.id}
              onClick={() => onCategory(category.name)}
            >
              <img
                src={
                  category.image ||
                  categoryImages[index % categoryImages.length]
                }
                alt=""
                loading="lazy"
              />
              <span className="category-overlay" />
              <span className="category-index">0{index + 1}</span>
              <strong>{category.name}</strong>
              <small>{category.description}</small>
              <b>Explore category ↗</b>
            </button>
          ))}
        </div>
      </section>
      <section className="catalog-preview">
        <div className="section-heading">
          <div>
            <p className="eyebrow">02 / LIVE CATALOGUE</p>
            <h2>
              Ready for the <em>real world.</em>
            </h2>
          </div>
          <button className="text-button" onClick={onProducts}>
            Browse catalogue ↗
          </button>
        </div>
        <div className="product-grid">
          {products.slice(0, 4).map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              quantity={cart.find((item) => item.product.id === product.id)?.quantity || 0}
              onProduct={onProduct}
              addToCart={addToCart}
              setCartQuantity={setCartQuantity}
            />
          ))}
        </div>
      </section>
      <section className="about-band" id="about">
        <p className="eyebrow">THE MURUGESAN STANDARD</p>
        <h2>
          Good work starts with the <em>right stuff.</em>
        </h2>
        <p>
          From one switch to a full site requirement, our counter is built
          around genuine products, fair advice and dependable local service.
        </p>
        <button className="button light" onClick={onContact}>
          Call 9361866771 ↗
        </button>
      </section>
      <footer id="contact">
        <Logo compact />
        <span>Andiappanur, Tirupathur - 635702</span>
        <a href="tel:9361866771">9361866771</a>
        <span>GSTIN: 33APCPM6660B1Z9</span>
      </footer>
    </main>
  );
}
function ProductsPage({
  products,
  categories,
  query,
  setQuery,
  activeCategory,
  setCategory,
  cart,
  onProduct,
  addToCart,
  setCartQuantity,
}: {
  products: Product[];
  categories: Category[];
  query: string;
  setQuery: (value: string) => void;
  activeCategory: string;
  setCategory: (value: string) => void;
  cart: { product: Product; quantity: number }[];
  onProduct: (p: Product) => void;
  addToCart: (p: Product) => void;
  setCartQuantity: (p: Product, quantity: number) => void;
}) {
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PRODUCT CATALOGUE</p>
          <h1>
            Find the right <em>essential.</em>
          </h1>
          <p>
            Browse our live selection of electrical, hardware, tools and
            plumbing supplies.
          </p>
        </div>
      </div>
      <div className="filters">
        <label className="search">
          <span>⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, code, brand..."
          />
        </label>
        <select
          value={activeCategory}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option>All</option>
          {categories.map((c) => (
            <option key={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="product-grid">
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            quantity={cart.find((item) => item.product.id === product.id)?.quantity || 0}
            onProduct={onProduct}
            addToCart={addToCart}
            setCartQuantity={setCartQuantity}
          />
        ))}
      </div>
      {!products.length && (
        <div className="empty-state">
          <h2>No products found</h2>
          <p>Try another search or browse a different category.</p>
        </div>
      )}
    </main>
  );
}
function ProductCard({
  product,
  quantity,
  onProduct,
  addToCart,
  setCartQuantity,
}: {
  product: Product;
  quantity: number;
  onProduct: (p: Product) => void;
  addToCart: (p: Product) => void;
  setCartQuantity: (p: Product, quantity: number) => void;
}) {
  const [inputQuantity, setInputQuantity] = useState(1);
  const unavailable = product.stock === 0;
  
  const handleAddToCart = () => {
    // Add the item with the specified quantity
    for (let i = 0; i < inputQuantity; i++) {
      addToCart(product);
    }
    setInputQuantity(1); // Reset to 1 after adding
  };
  
  return (
    <article className="product-card">
      <button
        className="product-image"
        style={{ backgroundImage: `url(${product.image || fallbackImage})` }}
        onClick={() => onProduct(product)}
        aria-label={`View ${product.name}`}
      >
        <span className="tag">{product.category}</span>
        <span className="view-arrow">↗</span>
      </button>
      <div className="product-info">
        <p className="product-brand">
          {product.brand || "Murugesan"}{" "}
          <span>{product.code || "NO CODE"}</span>
        </p>
        <button className="product-name" onClick={() => onProduct(product)}>
          {product.name}
        </button>
        <p className="product-description">{product.description}</p>
        <div className="price-row">
          <strong>{money(product.price)}</strong>
          {product.mrp > product.price && <del>{money(product.mrp)}</del>}
          <span
            className={`stock ${unavailable ? "out" : product.stock < 10 ? "low" : ""}`}
          >
            ● {statusOf(product.stock)}
          </span>
        </div>
        {quantity > 0 ? (
          <QuantityControl
            product={product}
            quantity={quantity}
            setQuantity={setCartQuantity}
          />
        ) : (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="number"
              min="1"
              max={product.stock || 9999}
              value={inputQuantity}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 1;
                setInputQuantity(Math.max(1, Math.min(product.stock || 9999, val)));
              }}
              disabled={unavailable}
              style={{
                width: '70px',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                textAlign: 'center',
                fontSize: '14px'
              }}
              placeholder="Qty"
            />
            <button
              className="add-button"
              disabled={unavailable}
              onClick={handleAddToCart}
              style={{ flex: 1 }}
            >
              {unavailable ? "Out of stock" : "Add to cart"}{" "}
              <b>{unavailable ? "−" : "+"}</b>
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
function QuantityControl({
  product,
  quantity,
  setQuantity,
}: {
  product: Product;
  quantity: number;
  setQuantity: (product: Product, quantity: number) => void;
}) {
  return (
    <div
      className="quantity product-quantity"
      aria-label={`Quantity for ${product.name}`}
    >
      <button
        type="button"
        aria-label={`Decrease ${product.name} quantity`}
        onClick={() => setQuantity(product, quantity - 1)}
      >
        −
      </button>
      <input
        type="number"
        min="1"
        max={product.stock}
        aria-label={`${product.name} quantity`}
        value={quantity}
        onChange={(event) => setQuantity(product, Number(event.target.value))}
      />
      <button
        type="button"
        aria-label={`Increase ${product.name} quantity`}
        onClick={() => setQuantity(product, quantity + 1)}
      >
        +
      </button>
    </div>
  );
}
function Detail({
  product,
  related,
  cart,
  quantity,
  onBack,
  onProduct,
  addToCart,
  setCartQuantity,
}: {
  product: Product;
  related: Product[];
  cart: { product: Product; quantity: number }[];
  quantity: number;
  onBack: () => void;
  onProduct: (p: Product) => void;
  addToCart: (p: Product) => void;
  setCartQuantity: (p: Product, quantity: number) => void;
}) {
  return (
    <main className="detail-page">
      <button className="back-button" onClick={onBack}>
        ← Back to products
      </button>
      <div className="detail-grid">
        <div
          className="detail-image"
          style={{ backgroundImage: `url(${product.image || fallbackImage})` }}
        />
        <div className="detail-copy">
          <p className="eyebrow">
            {product.category} / {product.code}
          </p>
          <h1>{product.name}</h1>
          <p className="detail-brand">
            {product.brand || "Murugesan Electrical"}
          </p>
          <p className="detail-description">{product.description}</p>
          <div className="detail-price">
            {money(product.price)}{" "}
            {product.mrp > product.price && <del>{money(product.mrp)}</del>}
          </div>
          <p className="detail-stock">
            ●{" "}
            {product.stock
              ? `${product.stock} ${product.unit} available`
              : "Currently out of stock"}
          </p>
          {quantity > 0 ? (
            <QuantityControl
              product={product}
              quantity={quantity}
              setQuantity={setCartQuantity}
            />
          ) : (
            <button
              className="button blue"
              disabled={!product.stock}
              onClick={() => addToCart(product)}
            >
              Add to cart +
            </button>
          )}
          <button className="whatsapp" onClick={() => whatsapp(product)}>
            Enquire on WhatsApp ↗
          </button>
          <div className="spec-box">
            <span>
              Product code<strong>{product.code || "Not assigned"}</strong>
            </span>
            <span>
              Specifications
              <strong>{product.details || "Quality trade essential"}</strong>
            </span>
            <span>
              Unit<strong>{product.unit}</strong>
            </span>
          </div>
        </div>
      </div>
      {related.length > 0 && (
        <section className="related">
          <p className="eyebrow">YOU MAY ALSO NEED</p>
          <h2>Related products</h2>
          <div className="product-grid">
            {related.map((item) => (
              <ProductCard
                key={item.id}
                product={item}
                quantity={
                  cart.find((cartItem) => cartItem.product.id === item.id)
                    ?.quantity || 0
                }
                onProduct={onProduct}
                addToCart={addToCart}
                setCartQuantity={setCartQuantity}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
function Cart({
  items,
  setCart,
  customerToken,
  customer,
  onCustomerLogin,
  onOpenAccount,
  onProducts,
  onNotify,
}: {
  items: { product: Product; quantity: number }[];
  setCart: (items: { product: Product; quantity: number }[]) => void;
  customerToken: string;
  customer: Customer | null;
  onCustomerLogin: () => void;
  onOpenAccount: () => void;
  onProducts: () => void;
  onNotify: (message: string) => void;
}) {
  const subtotal = items.reduce(
    (total, item) => total + item.product.price * item.quantity,
    0,
  );
  return (
    <main className="page cart-page">
      <p className="eyebrow">YOUR ENQUIRY</p>
      <h1>
        Cart <em>({items.length})</em>
      </h1>
      {items.length ? (
        <>
          <div className="cart-list">
            {items.map(({ product, quantity }) => (
              <div className="cart-item" key={product.id}>
                <img src={product.image || fallbackImage} alt="" />
                <div>
                  <strong>{product.name}</strong>
                  <small>
                    {product.code} · {money(product.price)} / {product.unit}
                  </small>
                </div>
                <div className="quantity">
                  <button
                    onClick={() =>
                      setCart(
                        items.map((item) =>
                          item.product.id === product.id
                            ? { ...item, quantity: Math.max(1, quantity - 1) }
                            : item,
                        ),
                      )
                    }
                    disabled={quantity <= 1}
                    style={{ opacity: quantity <= 1 ? 0.4 : 1, cursor: quantity <= 1 ? 'not-allowed' : 'pointer' }}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="1"
                    max={product.stock || 9999}
                    value={quantity}
                    onChange={(e) => {
                      const newQty = parseInt(e.target.value) || 1;
                      const validQty = Math.max(1, Math.min(product.stock || 9999, newQty));
                      setCart(
                        items.map((item) =>
                          item.product.id === product.id
                            ? { ...item, quantity: validQty }
                            : item,
                        ),
                      );
                    }}
                    style={{
                      width: '60px',
                      textAlign: 'center',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      padding: '4px',
                      fontSize: '14px'
                    }}
                  />
                  <button
                    onClick={() =>
                      setCart(
                        items.map((item) =>
                          item.product.id === product.id
                            ? { ...item, quantity: Math.min(product.stock || 9999, quantity + 1) }
                            : item,
                        ),
                      )
                    }
                    disabled={quantity >= (product.stock || 9999)}
                    style={{ opacity: quantity >= (product.stock || 9999) ? 0.4 : 1, cursor: quantity >= (product.stock || 9999) ? 'not-allowed' : 'pointer' }}
                  >
                    +
                  </button>
                </div>
                <button
                  className="remove"
                  onClick={() =>
                    setCart(
                      items.filter((item) => item.product.id !== product.id),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="cart-summary">
            <span>
              Estimated subtotal<strong>{money(subtotal)}</strong>
            </span>
            <p>Final price and availability will be confirmed by our team.</p>
            <button
              className="button blue"
              onClick={() => {
                const message = `Hello Murugesan Electrical and Hardwares, I am interested in:\n${items
                  .map(
                    ({ product, quantity }) =>
                      `Product: ${product.name}\nCode: ${product.code}\nQuantity: ${quantity}\nPrice: ${money(product.price)}`,
                  )
                  .join("\n\n")}`;
                const url = buildWhatsAppUrl(businessWhatsappNumber, message);
                if (url) {
                  const opened = openWhatsAppUrl(url);
                  if (!opened) {
                    onNotify("WhatsApp could not be opened.");
                  }
                } else {
                  onNotify("Unable to create WhatsApp message.");
                }
              }}
            >
              Send enquiry on WhatsApp ↗
            </button>
          </div>
          {customerToken ? (
            <CustomerCheckout
              token={customerToken}
              customer={customer}
              items={items}
              onComplete={(orderedProductIds) => {
                setCart(
                  items.filter(
                    (item) => !orderedProductIds.includes(item.product.id),
                  ),
                );
                onOpenAccount();
              }}
            />
          ) : (
            <section className="customer-checkout page">
              <p className="eyebrow">CHECKOUT</p>
              <h2>Login to place an order</h2>
              <p>
                Sign in to save your delivery address and complete checkout
                safely.
              </p>
              <button className="button blue" onClick={onCustomerLogin}>
                Sign in / create account
              </button>
            </section>
          )}
        </>
      ) : (
        <div className="empty-state">
          <h2>Your cart is empty</h2>
          <p>Add products to create an enquiry for the store.</p>
          <button className="button dark" onClick={onProducts}>
            Browse products
          </button>
        </div>
      )}
    </main>
  );
}
function whatsapp(product: Product) {
  const message = `Hello Murugesan Electrical and Hardwares, I am interested in:\nProduct: ${product.name}\nCode: ${product.code}\nQuantity: 1\nPrice: ${money(product.price)}\n\nPlease confirm availability and final price.`;
  const url = buildWhatsAppUrl(businessWhatsappNumber, message);
  if (url) {
    openWhatsAppUrl(url);
  }
}
function Login({
  onLogin,
}: {
  onLogin: (mobile: string, password: string) => Promise<void>;
}) {
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  return (
    <main className="login-page">
      <div className="login-card">
        <Logo />
        <p className="eyebrow">STORE MANAGEMENT</p>
        <h1>Welcome back.</h1>
        <p>Sign in with your mobile number or email and password.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            setLoading(true);
            onLogin(mobile, password)
              .catch((reason: unknown) =>
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Invalid credentials.",
                ),
              )
              .finally(() => setLoading(false));
          }}
        >
          <label>
            Mobile number or email
            <input
              autoFocus
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="+91 93618 67771 or owner@murugesan.in"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
            />
          </label>
          <button className="button blue" type="submit" disabled={loading}>
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
        {error && <small className="warning">{error}</small>}
        <small>Use the admin credentials configured in the API environment.</small>
      </div>
    </main>
  );
}
type ImportItem = {
  row: number;
  raw: Record<string, string>;
  product: Product;
};
function importCsv(
  event: ChangeEvent<HTMLInputElement>,
  categories: Category[],
  products: Product[],
  setProducts: (items: Product[]) => void,
  notify: (message: string) => void,
) {
  void event;
  void categories;
  void products;
  void setProducts;
  notify("Use Products > Bulk Import to validate before importing");
}
const importHeaders = [
  "SKU",
  "Product Name",
  "Category",
  "Brand",
  "Product Type",
  "Price",
  "Discount",
  "Stock",
  "Description",
  "Image 1",
  "Image 2",
  "Image 3",
  "Status",
];
const headerKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
function makeProduct(
  raw: Record<string, string>,
  row: number,
  categories: Category[],
): Product {
  const value = (name: string) => raw[headerKey(name)] || "";
  const valueAny = (...names: string[]) => names.map((name) => value(name)).find(Boolean) || "";
  const category = value("Category");
  return {
    id: Date.now() + row,
    name: value("Product Name"),
    code: value("SKU") || value("Product Code"),
    category,
    brand: value("Brand"),
    price: Number(valueAny("Price", "Price (₹)", "Price ₹")),
    mrp: Number(valueAny("MRP", "MRP (₹)")) || Number(valueAny("Price", "Price (₹)")),
    stock: Number(valueAny("Stock", "Stock Qty", "Stock Quantity", "Quantity")),
    unit: value("Unit") || "Nos",
    image: valueAny("Image URL", "Image 1"),
    description: value("Description"),
    details: valueAny("Product Type", "Subcategory"),
    status:
      value("Status").toLowerCase() === "inactive" ? "Inactive" : "Active",
    attributes: Object.fromEntries(
      (
        categories.find(
          (item) => item.name.toLowerCase() === category.toLowerCase(),
        )?.attributes || []
      )
        .map((attribute) => [attribute.name, value(attribute.name)])
        .filter(([, attributeValue]) => attributeValue),
    ),
  };
}
function BulkProductImport({
  products,
  categories,
  setProducts,
  notify,
}: {
  products: Product[];
  categories: Category[];
  setProducts: Dispatch<SetStateAction<Product[]>>;
  notify: (message: string) => void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [duplicateMode, setDuplicateMode] = useState<"skip" | "update">("skip");
  const [items, setItems] = useState<ImportItem[]>([]);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [fileName, setFileName] = useState("");
  const [totalRows, setTotalRows] = useState(0);
  const selectedCategory = categories.find(
    (category) => String(category.id) === categoryId,
  );
  const columns = [
    ...importHeaders,
    ...(selectedCategory?.attributes || []).map((attribute) => attribute.name),
  ];
  const downloadTemplate = () => {
    const sheet = XLSX.utils.aoa_to_sheet([columns]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Products");
    XLSX.writeFile(
      book,
      `${selectedCategory?.slug || "products"}-import-template.xlsx`,
    );
  };
  const validate = async (file: File) => {
    setFileName(file.name);
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<string[]>(
      workbook.Sheets[workbook.SheetNames[0]],
      { header: 1, defval: "" },
    );
    const headers = (rows.shift() || []).map(String);
    setTotalRows(rows.length);
    console.debug("[bulk-import] parsed file", {
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      rows: rows.length,
      normalizedHeaders: headers.map(headerKey),
    });
    const seen = new Set<string>();
    const nextItems: ImportItem[] = [];
    const nextErrors: ImportError[] = [];
    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const raw = Object.fromEntries(
        headers.map((header, column) => [
          headerKey(header),
          String(row[column] ?? "").trim(),
        ]),
      );
      const rawValue = (...names: string[]) =>
        names.map((name) => raw[headerKey(name)] || "").find(Boolean) || "";
      const product = makeProduct(raw, rowNumber, categories);
      const sku = product.code;
      const error = (field: string, message: string) =>
        nextErrors.push({ row: rowNumber, sku, field, message });
      if (!sku) error("SKU", "SKU is required");
      if (seen.has(sku.toLowerCase()))
        error("SKU", "Duplicate SKU in this file");
      const existingSku = products.some(
        (item) => item.code.toLowerCase() === sku.toLowerCase(),
      );
      if (existingSku && duplicateMode === "update") {
        // Existing products are sent to the server for the selected update mode.
      }
      if (!product.name) error("Product Name", "Product name is required");
      if (!product.category || !product.category.trim())
        error("Category", "Category is required");
      const priceText = rawValue("Price", "Price (₹)", "Price ₹");
      const stockText = rawValue("Stock", "Stock Qty", "Stock Quantity", "Quantity");
      if (!priceText || !Number.isFinite(product.price) || product.price < 0)
        error("Price", "Price must be a number greater than or equal to 0");
      if (!stockText || !Number.isFinite(product.stock) || !Number.isInteger(product.stock) || product.stock < 0)
        error("Stock", "Stock must be zero or greater");
      const discount = Number(raw.discount || 0);
      if (!Number.isFinite(discount) || discount < 0 || discount > 100)
        error("Discount", "Discount must be between 0 and 100");
      if (product.status !== "Active" && product.status !== "Inactive")
        error("Status", "Status must be Active or Inactive");
      seen.add(sku.toLowerCase());
      if (!nextErrors.some((item) => item.row === rowNumber))
        nextItems.push({ row: rowNumber, raw, product });
    });
    setItems(nextItems);
    setErrors(nextErrors);
  };
  const importProducts = async () => {
    if (!items.length) return;
    if (
      !window.confirm(
        `Import ${items.length} valid product${items.length === 1 ? "" : "s"}?`,
      )
    )
      return;

    const apiToken = sessionStorage.getItem("murugesan-auth-token") || "";
    if (!apiToken) {
      notify("Admin login is required to import products.");
      return;
    }

    const payload = {
      duplicateMode,
      products: items.map(({ row, product }) => {
        const categoryId =
          product.categoryId ||
          categories.find(
            (category) =>
              category.name.toLowerCase() === product.category.toLowerCase(),
          )?.id;
        return {
          row,
          product: {
            ...product,
            sku: product.code,
            code: product.code,
            categoryId,
            category: product.category,
            productType: product.details || "",
            imageUrl: product.image || null,
            imageUrls: product.image ? [product.image] : [],
            status: product.status === "Inactive" ? "INACTIVE" : "ACTIVE",
            attributes: product.attributes || {},
            brand: product.brand || "",
          },
        };
      }),
    };

    try {
      const response = await fetch("/api/products/bulk-import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          result && typeof result.error === "string"
            ? result.error
            : "Unable to import products.",
        );
      }

      const imported = Number(result.imported || 0);
      const skipped = Number(result.skipped || 0);
      const failed = Number(result.failed || 0);
      const nextCatalog = await loadCatalog();
      setProducts(nextCatalog.products);
      notify(
        imported > 0
          ? `Import complete: ${imported} added${skipped ? `, ${skipped} skipped` : ""}${failed ? `, ${failed} failed` : ""}.`
          : skipped > 0
            ? `No new products created. ${skipped} existing SKU${skipped === 1 ? "" : "s"} were skipped.`
            : "Bulk import finished without creating products.",
      );
      setItems([]);
      setErrors([]);
    } catch (reason) {
      notify(
        reason instanceof Error
          ? reason.message
          : "Unable to import products. Please try again.",
      );
    }
  };
  const downloadErrors = () => {
    const sheet = XLSX.utils.json_to_sheet(
      errors.map((error) => ({
        Row: error.row,
        SKU: error.sku,
        Field: error.field,
        "Error Description": error.message,
      })),
    );
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Errors");
    XLSX.writeFile(book, "product-import-errors.xlsx");
  };
  return (
    <section className="bulk-import">
      <div className="admin-topline">
        <div>
          <p className="eyebrow">PRODUCTS / BULK IMPORT</p>
          <h1>Import products</h1>
          <p>
            Upload a CSV or Excel file, validate every row, then import only
            after review.
          </p>
        </div>
      </div>
      <div className="bulk-import-grid">
        <section className="panel import-step">
          <span className="import-step-number">01</span>
          <h2>Download template</h2>
          <p>Choose a category to include its configured attributes.</p>
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <button className="button blue" onClick={downloadTemplate}>
            Download Excel Template
          </button>
        </section>
        <section className="panel import-step">
          <span className="import-step-number">02</span>
          <h2>Upload and validate</h2>
          <p>
            Supports .xlsx, .xls and .csv files. No rows are imported
            automatically.
          </p>
          <label className="import-dropzone">
            <strong>{fileName || "Choose product spreadsheet"}</strong>
            <small>Click to select a file</small>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) =>
                event.target.files?.[0] && validate(event.target.files[0])
              }
            />
          </label>
          <label>
            Existing SKU handling
            <select
              value={duplicateMode}
              onChange={(event) =>
                setDuplicateMode(event.target.value as "skip" | "update")
              }
            >
              <option value="skip">Skip existing SKUs</option>
              <option value="update">Update existing products</option>
            </select>
          </label>
        </section>
      </div>
      {(items.length || errors.length) > 0 && (
        <section className="panel import-results">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">VALIDATION RESULTS</p>
              <h2>
                {totalRows} rows · {items.length} valid products · {errors.length} errors
              </h2>
            </div>
            <div>
              {errors.length > 0 && (
                <button className="text-button" onClick={downloadErrors}>
                  Download Error Report
                </button>
              )}
              {items.length > 0 && (
                <button className="button blue" onClick={importProducts}>
                  Import Products
                </button>
              )}
            </div>
          </div>
          {errors.length > 0 && (
            <div className="import-error-list">
              {errors.slice(0, 100).map((error) => (
                <div
                  className="import-error"
                  key={`${error.row}-${error.field}`}
                >
                  <strong>Row {error.row}</strong>
                  <span>SKU: {error.sku || "missing"}</span>
                  <b>{error.field}</b>
                  <small>{error.message}</small>
                </div>
              ))}
              {errors.length > 100 && (
                <p>Showing the first 100 errors of {errors.length}.</p>
              )}
            </div>
          )}
          {!errors.length && items.length > 0 && (
            <p>
              All rows passed validation. Review complete; the import button is
              ready.
            </p>
          )}
        </section>
      )}
    </section>
  );
}
function Admin({
  view,
  setView,
  products,
  categories,
  setProducts,
  setCategories,
  editing,
  setEditing,
  notify,
  onStore,
  onLogout,
}: {
  view: string;
  setView: (view: string) => void;
  products: Product[];
  categories: Category[];
  setProducts: Dispatch<SetStateAction<Product[]>>;
  setCategories: (items: Category[]) => void;
  editing: Product | null;
  setEditing: (product: Product | null) => void;
  notify: (message: string) => void;
  onStore: () => void;
  onLogout: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [orderCount, setOrderCount] = useState(0);
  const apiToken = sessionStorage.getItem("murugesan-auth-token") || "";
  useEffect(() => {
    if (!apiToken) return;
    fetch("/api/admin/orders", { headers: { Authorization: `Bearer ${apiToken}` } })
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: CustomerOrder[]) => setOrderCount(rows.length))
      .catch(() => setOrderCount(0));
  }, [apiToken, view]);
  useEffect(() => {
    if (!apiToken) return;
    loadAllCategories(apiToken)
      .then((allCategories) => setCategories(allCategories))
      .catch(() => {});
  }, [apiToken]);
  return (
    <>
      <header className="admin-header">
        <button className="admin-logo" onClick={onStore}>
          <Logo compact />
        </button>
        <div>
          <span>Store workspace</span>
          <strong>Murugesan Electrical and Hardwares</strong>
        </div>
        <button className="store-link" onClick={onStore}>
          View customer store ↗
        </button>
        <button className="admin-menu-button" type="button" aria-label="Open dashboard menu" onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? "×" : "☰"}
        </button>
      </header>
      {menuOpen && <button className="admin-drawer-backdrop" aria-label="Close dashboard menu" onClick={() => setMenuOpen(false)} />}
      <main className="admin-layout">
        <aside className={`sidebar${menuOpen ? " open" : ""}`}>
          <p className="eyebrow">MAIN MENU</p>
          {[
            "Dashboard",
            "Products",
            "Bulk Import",
            "Categories",
            "Inventory",
            "Orders / Enquiries",
            "Customers",
            "Settings",
          ].map((item) => (
            <button
              className={view === item ? "active" : ""}
              key={item}
              onClick={() => { setView(item); setMenuOpen(false); }}
            >
              {item === "Orders / Enquiries" && <b>{orderCount}</b>}
              {item}
            </button>
          ))}
          <button className="logout" onClick={() => { setMenuOpen(false); onLogout(); }}>
            Log out
          </button>
          <small>Logged in as Murugasan</small>
        </aside>
        <section className="admin-content">
          {view === "Products" || view === "Inventory" ? (
            <AdminProducts
              products={products}
              categories={categories}
              setProducts={setProducts}
              editing={editing}
              setEditing={setEditing}
              notify={notify}
              inventory={view === "Inventory"}
            />
          ) : view === "Bulk Import" ? (
            <BulkProductImport
              products={products}
              categories={categories}
              setProducts={setProducts}
              notify={notify}
            />
          ) : view === "Categories" ? (
            <DynamicCategoryManager
              categories={categories}
              setCategories={setCategories}
              products={products}
              notify={notify}
            />
          ) : view === "Customers" ? (
            <AdminCustomersList notify={notify} />
          ) : view === "Settings" ? (
            <AdminSettings notify={notify} />
          ) : view === "Orders / Enquiries" ? (
            <AdminOrdersList notify={notify} />
          ) : (
            <>
              <AdminDashboard
                view={view}
                products={products}
                categories={categories}
                onAdd={() => setEditing(emptyProduct(categories))}
                onProducts={() => setView("Products")}
              />
              <AdminExtras
                products={products}
                onAdd={() => setEditing(emptyProduct(categories))}
              />
            </>
          )}
        </section>
      </main>
    </>
  );
}
function emptyProduct(categories: Category[]): Product {
  // Filter to active categories only for new products
  const activeCategories = categories.filter(c => c.status !== "ARCHIVED" && c.active !== false);
  return {
    id: 0,
    name: "",
    code: "",
    category: activeCategories[0]?.name || categories[0]?.name || "Electrical Switches",
    brand: "",
    price: 0,
    mrp: 0,
    stock: 0,
    unit: "Nos",
    image: "",
    description: "",
    details: "",
  };
}
function AdminDashboard({
  view,
  products,
  categories,
  onAdd,
  onProducts,
}: {
  view: string;
  products: Product[];
  categories: Category[];
  onAdd: () => void;
  onProducts: () => void;
}) {
  void onProducts;
  const [stats, setStats] = useState<{
    products: number;
    categories: number;
    brands: number;
    customers: number;
    orders: number;
    revenue: number;
  } | null>(null);
  const apiToken = sessionStorage.getItem("murugesan-auth-token") || "";
  
  useEffect(() => {
    if (!apiToken || view !== "Dashboard") return;
    fetch("/api/admin/stats", {
      headers: { Authorization: `Bearer ${apiToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setStats(data);
      })
      .catch(() => {});
  }, [apiToken, view]);

  const low = products.filter((p) => p.stock > 0 && p.stock < 10).length;
  const currentDate = new Date().toLocaleDateString('en-GB', { 
    day: '2-digit', 
    month: 'short', 
    year: 'numeric' 
  }).toUpperCase();
  
  return (
    <>
      <div className="admin-topline">
        <div>
          <p className="eyebrow">{view.toUpperCase()} / {currentDate}</p>
          <h1>
            {view === "Dashboard" ? (
              <>
                Good morning, Murugasan <em>✦</em>
              </>
            ) : (
              view
            )}
          </h1>
          <p>Manage your store from one place.</p>
        </div>
        {view === "Dashboard" && (
          <button className="button blue" onClick={onAdd}>
            + Add Product
          </button>
        )}
      </div>
      {view === "Dashboard" ? (
        <div className="stats-grid">
          <Stat label="Total products" value={stats?.products ?? products.length} />
          <Stat
            label="Active products"
            value={
              products.filter((p) => p.stock > 0 && p.status !== "Inactive")
                .length
            }
          />
          <Stat label="Low stock" value={low} warning />
          <Stat
            label="Out of stock"
            value={products.filter((p) => p.stock === 0).length}
            warning
          />
          <Stat
            label="Active categories"
            value={stats?.categories ?? categories.filter((category) => category.active !== false).length}
          />
          <Stat label="Orders" value={stats?.orders ?? 0} />
        </div>
      ) : (
        <section className="panel empty-admin">
          <h2>{view}</h2>
          <p>
            This workspace is ready for the next store workflow. Products,
            inventory and catalogue changes stay live in this browser.
          </p>
        </section>
      )}
    </>
  );
}
function Stat({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value.toString().padStart(2, "0")}</strong>
      <small className={warning ? "warning" : ""}>
        {warning ? "Needs attention" : "Live now"}
      </small>
    </div>
  );
}
function AdminCustomersList({ notify }: { notify: (message: string) => void }) {
  const [customers, setCustomers] = useState<Array<{id:number; name:string; email:string; phone:string; status:string; createdAt:string; lastLogin?:string; orderCount:number; totalSpent:number}>>([]);
  const [loading, setLoading] = useState(true);
  const apiToken = sessionStorage.getItem("murugesan-auth-token") || "";
  const loadCustomers = async () => {
    if (!apiToken) return;
    setLoading(true);
    try {
      const response = await fetch("/api/admin/customers", { headers: { Authorization: `Bearer ${apiToken}` } });
      if (!response.ok) throw new Error("Unable to load customers");
      setCustomers((await response.json()) as typeof customers);
    } catch {
      notify("Unable to load customers");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void loadCustomers();
  }, [apiToken]);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">CUSTOMERS</p>
          <h2>Registered customers</h2>
        </div>
      </div>
      {loading ? (
        <p>Loading customers...</p>
      ) : customers.length ? (
        <div className="table-responsive" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Name</th>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Phone</th>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Email</th>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Joined</th>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Orders</th>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Spent</th>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "10px 8px" }}>{customer.name}</td>
                  <td style={{ padding: "10px 8px" }}>{customer.phone || "N/A"}</td>
                  <td style={{ padding: "10px 8px" }}>{customer.email || "N/A"}</td>
                  <td style={{ padding: "10px 8px" }}>{customer.createdAt ? new Date(customer.createdAt).toLocaleDateString() : "N/A"}</td>
                  <td style={{ padding: "10px 8px" }}>{customer.orderCount}</td>
                  <td style={{ padding: "10px 8px" }}>{money(customer.totalSpent || 0)}</td>
                  <td style={{ padding: "10px 8px" }}>{customer.status || "ACTIVE"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No registered customers yet.</p>
      )}
    </section>
  );
}
function AdminOrdersList({ notify }: { notify: (message: string) => void }) {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const apiToken = sessionStorage.getItem("murugesan-auth-token") || "";
  const loadOrders = async () => {
    if (!apiToken) return;
    setLoading(true);
    try {
      const response = await fetchWithTimeout("/api/admin/orders", {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!response.ok) throw new Error("Unable to load orders");
      const rows = (await response.json()) as CustomerOrder[];
      setOrders(rows);
    } catch (error) {
      console.error('[AdminOrdersList] Load orders error:', error);
      notify(error instanceof Error ? error.message : "Unable to load orders");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void loadOrders();
  }, [apiToken]);
  const filtered = orders.filter((order) => {
    const matchesStatus = filter === "All" || order.status === filter;
    const matchesQuery =
      !query ||
      order.orderNumber.toLowerCase().includes(query.toLowerCase()) ||
      (order.customerName || "").toLowerCase().includes(query.toLowerCase()) ||
      (order.customerPhone || "").toLowerCase().includes(query.toLowerCase());
    return matchesStatus && matchesQuery;
  });
  const updateStatus = async (orderId: number, nextStatus: string) => {
    try {
      const response = await fetchWithTimeout(`/api/admin/orders/${orderId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!response.ok) {
        notify("Unable to update order status");
        return;
      }
      const updated = (await response.json()) as CustomerOrder;
      setOrders((current) =>
        current.map((order) => (order.id === updated.id ? updated : order)),
      );
      const notificationUrl = updated.notification?.whatsappUrl;
      if (nextStatus === "CONFIRMED" && notificationUrl) {
        notify("Order confirmed. Opening WhatsApp...");
        openWhatsAppUrl(notificationUrl);
        return;
      }
      notify(
        updated.notification?.error
          ? `Order status updated, but WhatsApp failed: ${updated.notification.error}`
          : "Order status updated",
      );
    } catch (error) {
      console.error('[AdminOrdersList] Update status error:', error);
      notify(error instanceof Error ? error.message : "Unable to update order status");
    }
  };
  const confirmOrder = async (order: CustomerOrder) => {
    try {
      const response = await fetchWithTimeout(`/api/orders/${order.id}/confirm`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
        },
      });
      const raw = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(raw.error || "Unable to confirm order");
        return;
      }
      const confirmedOrder = (raw.order || order) as CustomerOrder;
      setOrders((current) =>
        current.map((item) => (item.id === confirmedOrder.id ? confirmedOrder : item)),
      );
      const whatsappUrl = String(raw.whatsappUrl || "").trim();
      if (raw.alreadyConfirmed) {
        notify("Order already confirmed.");
      } else {
        notify("Order confirmed.");
      }
      if (whatsappUrl) {
        const opened = openWhatsAppUrl(whatsappUrl);
        if (!opened) {
          notify("Order confirmed, but WhatsApp could not be opened.");
        }
      } else {
        notify("Order confirmed, but WhatsApp URL is missing.");
      }
    } catch (error) {
      console.error("Confirm order error:", error);
      notify(error instanceof Error ? error.message : "Unable to confirm order. Please try again.");
    }
  };
  const notifyCustomer = async (order: CustomerOrder) => {
    try {
      const response = await fetchWithTimeout(`/api/orders/${order.id}/notify`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        notify(result.error || "Customer notification could not be prepared.");
        return;
      }
      const result = (await response.json()) as { whatsappUrl?: string; url?: string };
      const url = result.whatsappUrl || result.url || "";
      if (!url) {
        notify("Customer notification could not be prepared.");
        return;
      }
      const opened = openWhatsAppUrl(url);
      if (!opened) {
        notify("WhatsApp could not be opened.");
      }
    } catch (error) {
      console.error('[AdminOrdersList] Notify customer error:', error);
      notify(error instanceof Error ? error.message : "Customer notification could not be prepared.");
    }
  };
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">ORDERS</p>
          <h2>All customer orders</h2>
        </div>
      </div>
      <div className="filters" style={{ margin: "0 0 16px" }}>
        <label className="search">
          <span>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by order ID, customer or phone"
          />
        </label>
        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="All">All</option>
          {[
            "PENDING",
            "CONFIRMED",
            "REJECTED",
            "PROCESSING",
            "OUT_FOR_DELIVERY",
            "DELIVERED",
            "CANCELLED",
          ].map((status) => (
            <option value={status} key={status}>
              {formatOrderStatus(status)}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <p>Loading orders...</p>
      ) : filtered.length ? (
        filtered.map((order) => (
          <div className="order-card" key={order.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <strong>{order.orderNumber}</strong>
                <small style={{ display: "block" }}>
                  {order.customerName || "Customer"} · {order.customerPhone || "No phone"}
                </small>
              </div>
              <span>{formatOrderStatus(order.status)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, gap: 12 }}>
              <small>{new Date(order.createdAt).toLocaleDateString()}</small>
              <small>{order.items.length} items</small>
              <strong>{money(order.total)}</strong>
            </div>
            <div style={{ marginTop: 12 }}>
              <p><strong>Customer:</strong> {order.customerName || "Customer"}</p>
              <p><strong>Mobile:</strong> {order.customerPhone || "N/A"}</p>
              {order.gstNumber && <p><strong>GST:</strong> {order.gstNumber}</p>}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button className="plain-button" type="button" onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}>
                {expandedId === order.id ? "Hide details" : "View details"}
              </button>
              {order.status === "PENDING" && (
                <>
                  <button
                    className="button blue"
                    type="button"
                    onClick={() => void confirmOrder(order)}
                  >
                    Confirm Order
                  </button>
                  {nextOrderStatuses[order.status]?.includes("REJECTED") && (
                    <button
                      className="plain-button"
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Reject order ${order.orderNumber}?`)) {
                          void updateStatus(order.id, "REJECTED");
                        }
                      }}
                    >
                      Reject Order
                    </button>
                  )}
                </>
              )}
              {(nextOrderStatuses[order.status] || []).filter((s) => s !== "CONFIRMED" && s !== "REJECTED").map((status) => (
                <button
                  className="plain-button"
                  type="button"
                  key={status}
                  onClick={() => {
                    if (status === "CANCELLED" && !window.confirm(`Cancel order ${order.orderNumber}?`)) return;
                    void updateStatus(order.id, status);
                  }}
                >
                  {status === "CANCELLED" ? "Cancel Order" : `Mark ${formatOrderStatus(status)}`}
                </button>
              ))}
              <button className="plain-button" type="button" onClick={() => void notifyCustomer(order)}>
                Notify Customer on WhatsApp
              </button>
            </div>
            {expandedId === order.id && (
              <div style={{ marginTop: 16 }}>
                <p><strong>Customer:</strong> {order.customerName}</p>
                <p><strong>Email:</strong> {order.customerEmail || "N/A"}</p>
                <p><strong>Phone:</strong> {order.customerPhone || "N/A"}</p>
                {order.gstNumber && <p><strong>GST:</strong> {order.gstNumber}</p>}
                <p><strong>Address:</strong> {orderAddressText(order.deliveryAddress) || "N/A"}</p>
                <ul>
                  {order.items.map((item, index) => (
                    <li key={`${order.id}-${index}`}>
                      {item.productName || item.name || "Item"} × {item.quantity} — {money((item.unitPrice ?? item.price) * item.quantity)}
                    </li>
                  ))}
                </ul>
                {order.statusHistory?.length ? (
                  <div>
                    <strong>Status history</strong>
                    {order.statusHistory.map((history) => (
                      <p key={history.id}>
                        {formatOrderStatus(history.status)} · {new Date(history.createdAt).toLocaleString()}
                        {history.note ? ` · ${history.note}` : ""}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ))
      ) : (
        <p>No customer orders yet.</p>
      )}
    </section>
  );
}
function AdminProducts({
  products,
  categories,
  setProducts,
  editing,
  setEditing,
  notify,
  inventory,
}: {
  products: Product[];
  categories: Category[];
  setProducts: Dispatch<SetStateAction<Product[]>>;
  editing: Product | null;
  setEditing: (product: Product | null) => void;
  notify: (message: string) => void;
  inventory: boolean;
}) {
  const apiToken = sessionStorage.getItem("murugesan-auth-token") || "";
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("All");
  const [inlineStockDrafts, setInlineStockDrafts] = useState<Record<number, string>>({});
  const [savingStock, setSavingStock] = useState<Record<number, boolean>>({});
  const visible = products.filter(
    (p) =>
      `${p.name} ${p.code} ${p.brand} ${p.category}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (category === "All" || p.category === category) &&
      (status === "All" || statusOf(p.stock) === status),
  );
  const commitInlineStock = async (product: Product, rawValue: string) => {
    const trimmed = String(rawValue ?? "").trim();
    if (!trimmed) {
      setInlineStockDrafts((current) => ({ ...current, [product.id]: String(product.stock) }));
      return;
    }
    const stock = Number(trimmed);
    if (!Number.isInteger(stock) || stock < 0 || !Number.isFinite(stock)) {
      setInlineStockDrafts((current) => ({ ...current, [product.id]: String(product.stock) }));
      notify("Stock must be a whole number greater than or equal to 0.");
      return;
    }
    if (stock === product.stock) {
      setInlineStockDrafts((current) => ({ ...current, [product.id]: String(stock) }));
      return;
    }
    if (savingStock[product.id]) return;
    setSavingStock((current) => ({ ...current, [product.id]: true }));
    try {
      const saved = await saveProductStockRequest(apiToken, product.id, stock);
      setProducts((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      setInlineStockDrafts((current) => ({ ...current, [product.id]: String(saved.stock) }));
    } catch (reason) {
      setInlineStockDrafts((current) => ({ ...current, [product.id]: String(product.stock) }));
      notify(reason instanceof Error ? reason.message : "Unable to update stock. Please try again.");
    } finally {
      setSavingStock((current) => ({ ...current, [product.id]: false }));
    }
  };
  const save = async (product: Product) => {
    try {
      console.log('[AdminProducts] Saving product:', product);
      const saved = await saveProductRequest(apiToken, product, categories);
      console.log('[AdminProducts] Product saved successfully:', saved);
      setProducts(
        product.id
          ? products.map((item) => (item.id === saved.id ? saved : item))
          : [saved, ...products],
      );
      setEditing(null);
      notify(product.id ? "Product updated successfully" : "Product added successfully");
    } catch (reason) {
      console.error('[AdminProducts] Save error:', reason);
      notify(reason instanceof Error ? reason.message : "Unable to save product. Please try again.");
      throw reason; // Re-throw so the form can handle it
    }
  };
  const remove = async (id: number) => {
    if (
      window.confirm(
        "Delete Product?\n\nAre you sure you want to delete this product? This action cannot be undone.",
      )
    ) {
      const response = await fetch(`/api/products/${id}/archive`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!response.ok) {
        notify("Unable to delete product. Please try again.");
        return;
      }
      setProducts(products.filter((p) => p.id !== id));
      notify("Product deleted");
    }
  };
  return (
    <>
      <div className="admin-topline">
        <div>
          <p className="eyebrow">
            CATALOGUE / {inventory ? "INVENTORY" : "PRODUCTS"}
          </p>
          <h1>
            {inventory ? "Inventory" : "Products"}{" "}
            <span className="count-badge">{products.length}</span>
          </h1>
          <p>Manage your store products and inventory.</p>
        </div>
        <button
          className="button blue"
          onClick={() => setEditing(emptyProduct(categories))}
        >
          + Add Product
        </button>
      </div>
      <div className="table-toolbar">
        <label className="search">
          <span>⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, code, SKU or brand"
          />
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option>All</option>
          {categories.map((c) => (
            <option key={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option>All</option>
          <option>In stock</option>
          <option>Low stock</option>
          <option>Out of stock</option>
        </select>
        <label className="import-button">
          Import CSV
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) =>
              importCsv(e, categories, products, setProducts, notify)
            }
          />
        </label>
      </div>
      <div className="product-table">
        <div className="table-head">
          <span>PRODUCT</span>
          <span>CATEGORY</span>
          <span>PRICE</span>
          <span>STOCK</span>
          <span>STATUS</span>
          <span>ACTIONS</span>
        </div>
        {visible.map((p) => (
          <div className="table-row" key={p.id}>
            <span className="table-product">
              <img src={p.image || fallbackImage} alt="" />
              <strong>
                {p.name}
                <small>
                  {p.brand} · {p.code}
                </small>
              </strong>
            </span>
            <span>{p.category}</span>
            <span>{money(p.price)}</span>
            <span>
              <input
                className="stock-input"
                type="number"
                min="0"
                value={inlineStockDrafts[p.id] ?? String(p.stock)}
                onFocus={() => {
                  setInlineStockDrafts((current) => ({
                    ...current,
                    [p.id]: current[p.id] ?? String(p.stock),
                  }));
                }}
                onClick={(e) => {
                  if (document.activeElement !== e.currentTarget) return;
                  e.currentTarget.select();
                }}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setInlineStockDrafts((current) => ({
                    ...current,
                    [p.id]: nextValue,
                  }));
                }}
                onBlur={(e) => {
                  void commitInlineStock(p, e.currentTarget.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitInlineStock(p, e.currentTarget.value);
                  }
                  if (e.key === "Escape") {
                    setInlineStockDrafts((current) => ({
                      ...current,
                      [p.id]: String(p.stock),
                    }));
                  }
                }}
              />{" "}
              {p.unit}
            </span>
            <span className="status-text">
              <i
                className={p.stock === 0 ? "red" : p.stock < 10 ? "yellow" : ""}
              />
              {statusOf(p.stock)}
            </span>
            <span className="row-actions">
              <button onClick={() => setEditing(p)}>Edit</button>
              <button
                onClick={() =>
                  setEditing({
                    ...p,
                    id: 0,
                    code: `${p.code}-COPY`,
                    name: `${p.name} copy`,
                  })
                }
              >
                Duplicate
              </button>
              <button onClick={() => remove(p.id)}>Delete</button>
            </span>
          </div>
        ))}
      </div>
      {editing && (
        <ProductForm
          product={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </>
  );
}
function ProductForm({
  product,
  categories,
  onClose,
  onSave,
}: {
  product: Product;
  categories: Category[];
  onClose: () => void;
  onSave: (product: Product) => void;
}) {
  const [form, setForm] = useState(product);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const update = (key: keyof Product, value: string | number) =>
    setForm({ ...form, [key]: value });
  const upload = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update("image", String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <div className="form-overlay">
      <form
        className="product-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (form.name.trim() && form.code.trim() && form.price > 0) {
            setSaving(true);
            const nextProduct = {
              ...form,
              stock: normalizeProductStock(form.stock),
              image: form.image || fallbackImage,
            };
            try {
              await onSave(nextProduct);
            } catch (error) {
              console.error('[ProductForm] Save failed:', error);
            } finally {
              setSaving(false);
            }
          }
        }}
      >
        <div className="form-heading">
          <div>
            <p className="eyebrow">
              {product.id ? "EDIT PRODUCT" : "QUICK ADD PRODUCT"}
            </p>
            <h2>{product.id ? "Edit Product" : "Add Product"}</h2>
          </div>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        <label className="dropzone">
          {form.image && <img src={form.image} alt="Product preview" />}
          <strong>
            {form.image ? "Replace Product Image" : "Upload Product Image"}
          </strong>
          <small>Click to upload · JPG or PNG up to 10MB</small>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => upload(e.target.files?.[0])}
          />
        </label>
        <div className="form-grid">
          <label>
            Product Name *
            <input
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Enter product name"
              required
            />
          </label>
          <label>
            Product Code *
            <input
              value={form.code}
              onChange={(e) => update("code", e.target.value)}
              placeholder="Enter product code"
            />
          </label>
          <label>
            Category *
            <select
              value={form.category}
              onChange={(e) => update("category", e.target.value)}
            >
              {categories.filter(c => c.status !== "ARCHIVED" && c.active !== false).map((c) => (
                <option key={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            Selling Price *
            <input
              type="number"
              min="1"
              value={form.price || ""}
              onChange={(e) => update("price", Number(e.target.value))}
              placeholder="₹ Enter price"
              required
            />
          </label>
          <label>
            Stock Quantity
            <input
              type="number"
              min="0"
              value={form.stock}
              onChange={(e) => update("stock", Number(e.target.value))}
            />
          </label>
          <label>
            Unit
            <select
              value={form.unit}
              onChange={(e) => update("unit", e.target.value)}
            >
              <option>Nos</option>
              <option>Piece</option>
              <option>Box</option>
              <option>Set</option>
              <option>Meter</option>
              <option>Kg</option>
              <option>Other</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          className="advanced-toggle"
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced ? "− Hide details" : "+ Add More Details"}
        </button>
        {advanced && (
          <div className="advanced-fields">
            <label>
              Brand
              <input
                value={form.brand}
                onChange={(e) => update("brand", e.target.value)}
              />
            </label>
            <label>
              MRP
              <input
                type="number"
                value={form.mrp || ""}
                onChange={(e) => update("mrp", Number(e.target.value))}
              />
            </label>
            <label>
              Description
              <textarea
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
              />
            </label>
            <label>
              Specifications
              <input
                value={form.details}
                onChange={(e) => update("details", e.target.value)}
              />
            </label>
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="text-button" onClick={onClose}>
            Cancel
          </button>
          <button className="button blue" type="submit" disabled={saving}>
            {saving ? "Saving..." : product.id ? "Save Changes" : "Save Product"} ↗
          </button>
        </div>
      </form>
    </div>
  );
}
function LegacyAdminCategories({
  categories,
  setCategories,
  products,
  notify,
}: {
  categories: Category[];
  setCategories: (items: Category[]) => void;
  products: Product[];
  notify: (message: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <>
      <div className="admin-topline">
        <div>
          <p className="eyebrow">CATALOGUE / ORGANISE</p>
          <h1>
            Categories <span className="count-badge">{categories.length}</span>
          </h1>
          <p>Make products easier for customers to find.</p>
        </div>
      </div>
      <form
        className="inline-add"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          
          const apiToken = sessionStorage.getItem("murugesan-auth-token") || "";
          if (!apiToken) {
            notify("Not authenticated");
            return;
          }
          
          try {
            const response = await fetchWithTimeout("/api/categories", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiToken}`,
              },
              body: JSON.stringify({
                name: name.trim(),
                description: "New product category.",
                active: true,
              }),
            });
            
            if (!response.ok) {
              const error = await response.json().catch(() => ({}));
              throw new Error(error.error || "Failed to create category");
            }
            
            const newCategory = await response.json();
            setCategories([...categories, newCategory]);
            setName("");
            notify("Category added successfully");
          } catch (error) {
            notify(error instanceof Error ? error.message : "Failed to add category");
          }
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category name"
          required
        />
        <button className="button blue">Add category</button>
      </form>
      <div className="category-admin-grid">
        {categories.map((category) => (
          <div className="category-admin-card" key={category.id}>
            <span>◇</span>
            <strong>{category.name}</strong>
            <small>
              {products.filter((p) => p.category === category.name).length}{" "}
              products
            </small>
            <button
              onClick={async () => {
                if (!window.confirm(`Delete ${category.name}?`)) return;
                
                const apiToken = sessionStorage.getItem("murugesan-auth-token") || "";
                if (!apiToken) {
                  notify("Not authenticated");
                  return;
                }
                
                try {
                  const response = await fetchWithTimeout(`/api/categories/${category.id}/archive`, {
                    method: "PATCH",
                    headers: { Authorization: `Bearer ${apiToken}` },
                  });
                  
                  if (!response.ok) {
                    throw new Error("Failed to delete category");
                  }
                  
                  const result = await response.json();
                  
                  // Refresh categories from server
                  const refreshed = await fetchWithTimeout(`/api/categories`, {
                    headers: { Authorization: `Bearer ${apiToken}` },
                  });
                  
                  if (refreshed.ok) {
                    const updatedCategories = await refreshed.json();
                    setCategories(updatedCategories);
                  }
                  
                  if (result.deleted) {
                    notify("Category deleted successfully");
                  } else if (result.archived) {
                    notify(`Category archived (has ${result.productCount} products)`);
                  }
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Failed to delete category");
                }
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
function AdminSettings({ notify }: { notify: (message: string) => void }) {
  return (
    <>
      <div className="admin-topline">
        <div>
          <p className="eyebrow">SYSTEM / STORE PROFILE</p>
          <h1>Settings</h1>
          <p>Business details shown to customers and on invoices.</p>
        </div>
      </div>
      <section className="panel settings">
        <label>
          Business Name
          <input defaultValue="Murugesan Electrical and Hardwares - Tirupathur" />
        </label>
        <label>
          Phone
          <input defaultValue="9361866771" />
        </label>
        <label>
          GSTIN
          <input defaultValue="33APCPM6660B1Z9" />
        </label>
        <label>
          Address
          <textarea
            defaultValue={
              "Andiappanur Sub Post Office\nSf.No.163, 1A4 Main Road\nKurisilapattu Post\nAndiyappanur, Tirupathur - 635702"
            }
          />
        </label>
        <button
          className="button blue"
          onClick={() => notify("Business settings saved")}
        >
          Save settings
        </button>
      </section>
    </>
  );
}
function CustomerCheckout({
  token,
  customer,
  items,
  onComplete,
}: {
  token: string;
  customer: Customer | null;
  items: { product: Product; quantity: number }[];
  onComplete: (orderedProductIds: number[]) => void;
}) {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selected, setSelected] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef("");
  useEffect(() => {
    fetch("/api/me/addresses", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((value: Address[]) => {
        setAddresses(value);
        const defaultAddress = value.find((address) => address.isDefault) || value[0];
        const nextSelected = String(defaultAddress?.id || "");
        setSelected(nextSelected);
        setGstNumber(defaultAddress?.gstNumber || "");
      });
  }, [token]);
  const placeOrder = async () => {
    if (submitting) return;
    if (!items.length) {
      setMessage("Add at least one product to place an order");
      return;
    }
    const address = addresses.find((item) => String(item.id) === selected);
    if (!address) {
      setMessage("Please select a delivery address");
      return;
    }
    const customerMobileRaw = String(customer?.mobile || address.phone || "").trim();
    if (!customerMobileRaw || !isValidWhatsAppNumber(customerMobileRaw)) {
      setMessage("Please enter a valid WhatsApp-enabled mobile number.");
      return;
    }
    const normalizedGst = (gstNumber || address.gstNumber || "").trim().toUpperCase().replace(/\s+/g, "");
    if (normalizedGst && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z0-9]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$/.test(normalizedGst)) {
      setMessage("Please enter a valid GST number.");
      return;
    }
    const checkoutFingerprint = `${customer?.id || "customer"}:${selected}:${normalizedGst}:${items
      .map(({ product, quantity }) => `${product.id}-${quantity}`)
      .join(",")}`;
    if (idempotencyKey.current !== checkoutFingerprint) {
      idempotencyKey.current = checkoutFingerprint;
    }
    setSubmitting(true);
    setMessage("");

    // Create AbortController for timeout handling
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch("/api/me/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          addressId: selected,
          gstNumber: normalizedGst || undefined,
          customerMobile: customerMobileRaw,
          idempotencyKey: idempotencyKey.current,
          items: items.map(({ product, quantity }) => ({
            productId: product.id,
            name: product.name,
            quantity,
            price: product.price,
          })),
        }),
        signal: abortController.signal,
      });
      
      clearTimeout(timeoutId);
      
      const rawResult = await response.json().catch(() => ({}));
      
      if (!response.ok) {
        setMessage(rawResult.error || "Unable to place the order. Please try again.");
        return;
      }

      const whatsappUrl = String(rawResult.whatsappUrl || "").trim();
      
      if (!whatsappUrl) {
        setMessage("Order placed successfully, but WhatsApp could not be opened. Please contact the shop.");
        onComplete(items.map(({ product }) => product.id));
        return;
      }

      // Order created successfully, clear cart and open WhatsApp
      onComplete(items.map(({ product }) => product.id));
      setMessage("Opening WhatsApp...");
      
      const opened = openWhatsAppUrl(whatsappUrl);
      if (!opened) {
        setMessage("Order placed successfully, but WhatsApp could not be opened. Please contact the shop.");
      }
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        setMessage("Request timed out. Please check your connection and try again.");
      } else {
        setMessage("Unable to place the order. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="customer-checkout page">
      <p className="eyebrow">CHECKOUT</p>
      <h2>Delivery address</h2>
      {addresses.length ? (
        <>
          {addresses.map((address) => (
            <label className="checkout-address" key={address.id}>
              <input
                type="radio"
                name="delivery"
                checked={selected === String(address.id)}
                onChange={() => {
                  setSelected(String(address.id));
                  setGstNumber(address.gstNumber || "");
                }}
              />
              <span>
                <strong>
                  {address.type}
                  {address.isDefault ? " · Default" : ""}
                </strong>
                {address.fullName}
                <br />
                {address.addressLine1}, {address.city}
                <br />
                {address.state} - {address.pincode}
              </span>
            </label>
          ))}
          <label>
            GST Number (optional)
            <input
              type="text"
              value={gstNumber}
              onChange={(event) => setGstNumber(event.target.value)}
              placeholder="22AAAAA0000A1Z5"
            />
          </label>
          <button
            className="button blue"
            onClick={() => void placeOrder()}
            disabled={!items.length || submitting}
          >
            {submitting ? "PLACING ORDER..." : "PLACE ORDER"}
          </button>
        </>
      ) : (
        <>
          <p>
            No saved address. Add one from My Account before placing an order.
          </p>
          <button className="plain-button" type="button" onClick={() => onComplete([])}>
            Go to My Account
          </button>
        </>
      )}
      {message && <p className="form-error">{message}</p>}
    </section>
  );
}
async function customerAuth(
  path: "login" | "register",
  body: Record<string, string>,
): Promise<{ token: string; user: Customer }> {
  const response = await fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Unable to sign in");
  return result;
}
function CustomerLogin({
  onLogin,
  onAdmin,
}: {
  onLogin: (result: { token: string; user: Customer }) => void;
  onAdmin: () => void;
}) {
  const [register, setRegister] = useState(false);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (register) {
        const result = await customerAuth("register", { name, mobile, password });
        onLogin(result);
      } else {
        onLogin(await customerAuth("login", { mobile, password }));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in");
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <Logo />
        <p className="eyebrow">CUSTOMER ACCOUNT</p>
        <h1>{register ? "Create your account." : "Welcome back."}</h1>
        {register && (
          <label>
            Full name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
        )}
        <label>
          Mobile number or email
          <input
            type="text"
            value={mobile}
            onChange={(event) => setMobile(event.target.value)}
            placeholder="+91 93618 67771 or name@example.com"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="button blue" type="submit" disabled={loading}>
          {loading ? "Please wait..." : register ? "Create account" : "Sign in"}
        </button>
        <button
          className="plain-button"
          type="button"
          onClick={() => setRegister(!register)}
        >
          {register
            ? "Already have an account? Sign in"
            : "Create a customer account"}
        </button>
        <button className="plain-button" type="button" onClick={onAdmin}>
          Login
        </button>
      </form>
    </main>
  );
}
function Account({
  token,
  customer,
  setCustomer,
  onLogout,
}: {
  token: string;
  customer: Customer | null;
  setCustomer: (customer: Customer) => void;
  onLogout: () => void;
}) {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [editing, setEditing] = useState<Address | null>(null);
  const [message, setMessage] = useState("");
  const headers = { Authorization: `Bearer ${token}` };
  const load = async () => {
    const [profile, addressResponse, orderResponse] = await Promise.all([
      fetch("/api/me", { headers }),
      fetch("/api/me/addresses", { headers }),
      fetch("/api/me/orders", { headers }),
    ]);
    if (profile.ok) setCustomer(await profile.json());
    if (addressResponse.ok) setAddresses(await addressResponse.json());
    if (orderResponse.ok) setOrders(await orderResponse.json());
  };
  useEffect(() => {
    void load();
  }, []);
  const saveAddress = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payloadEntries = Array.from(form.entries()).map(([key, value]) => [
      key,
      typeof value === 'string' ? value : String(value),
    ]);
    const payload = Object.fromEntries(payloadEntries);
    const normalized = {
      type: String(payload.type || "Home").trim() || "Home",
      fullName: String(
        payload.fullName ?? payload.full_name ?? customer?.name ?? "",
      ).trim(),
      phone: String(payload.phone ?? "").trim(),
      gstNumber: String(payload.gstNumber ?? "").trim(),
      addressLine1: String(
        payload.addressLine1 ?? payload.address_line1 ?? "",
      ).trim(),
      addressLine2: String(
        payload.addressLine2 ?? payload.address_line2 ?? "",
      ).trim(),
      area: String(payload.area ?? "").trim(),
      city: String(payload.city ?? "").trim(),
      state: String(payload.state ?? "").trim(),
      pincode: String(payload.pincode ?? "").trim(),
      isDefault: form.get("isDefault") === "on" || Boolean(payload.isDefault),
    };
    const response = await fetch(
      editing?.id ? `/api/me/addresses/${editing.id}` : "/api/me/addresses",
      {
        method: editing?.id ? "PATCH" : "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(normalized),
      },
    );
    if (response.ok) {
      setEditing(null);
      setMessage("Address saved");
      void load();
    } else {
      const result = await response.json().catch(() => ({}));
      setMessage(result.error || "Unable to save address");
    }
  };
  const removeAddress = async (id: number) => {
    if (!window.confirm("Delete this address?")) return;
    const response = await fetch(`/api/me/addresses/${id}`, {
      method: "DELETE",
      headers,
    });
    if (response.ok) void load();
    else setMessage("Unable to delete address");
  };
  return (
    <main className="page customer-page">
      <div className="page-heading">
        <p className="eyebrow">MY ACCOUNT</p>
        <h1>{customer?.name || "Customer"}</h1>
        <p>{customer?.mobile}</p>
      </div>
      <section className="customer-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PROFILE</p>
            <h2>My profile</h2>
          </div>
          <button className="plain-button" onClick={onLogout}>
            Log out
          </button>
        </div>
        <ProfileEditor
          customer={customer}
          token={token}
          setCustomer={setCustomer}
        />
      </section>
      <section className="customer-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DELIVERY</p>
            <h2>My addresses</h2>
          </div>
          <button
            className="button blue"
            onClick={() =>
              setEditing({
                id: 0,
                type: "Home",
                fullName: customer?.name || "",
                phone: "",
                addressLine1: "",
                addressLine2: "",
                area: "",
                city: "",
                state: "",
                pincode: "",
                isDefault: addresses.length === 0,
              })
            }
          >
            + Add address
          </button>
        </div>
        {message && <p className="form-error">{message}</p>}
        {addresses.map((address) => (
          <div className="address-card" key={address.id}>
            <strong>
              {address.type}
              {address.isDefault ? " · Default" : ""}
            </strong>
            <p>
              {address.fullName}
              <br />
              {address.phone}
              <br />
              {address.addressLine1}
              <br />
              {address.addressLine2 && `${address.addressLine2}, `}
              {address.area}
              <br />
              {address.city}, {address.state} - {address.pincode}
            </p>
            <button
              className="plain-button"
              onClick={() => setEditing(address)}
            >
              Edit
            </button>
            <button
              className="plain-button"
              onClick={() => void removeAddress(address.id)}
            >
              Delete
            </button>
          </div>
        ))}
        {editing && (
          <form className="customer-form" onSubmit={saveAddress}>
            <h3>{editing.id ? "Edit address" : "Add address"}</h3>
            {(
              [
                "type",
                "fullName",
                "phone",
                "addressLine1",
                "addressLine2",
                "area",
                "city",
                "state",
                "pincode",
              ] as const
            ).map((field) => (
              <label key={field}>
                {field === "type" ? "Address type" : field}
                <input
                  name={field}
                  defaultValue={editing[field]}
                  required={[
                    "fullName",
                    "phone",
                    "addressLine1",
                    "city",
                    "state",
                    "pincode",
                  ].includes(field)}
                />
              </label>
            ))}
            <label>
              GST Number (optional)
              <input
                name="gstNumber"
                defaultValue={editing.gstNumber || ""}
                placeholder="22AAAAA0000A1Z5"
              />
            </label>
            <label>
              <input
                name="isDefault"
                type="checkbox"
                defaultChecked={editing.isDefault}
              />{" "}
              Set as default
            </label>
            <button className="button blue">Save address</button>
            <button
              type="button"
              className="plain-button"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </form>
        )}
      </section>
      <section className="customer-section">
        <p className="eyebrow">HISTORY</p>
        <h2>My orders {orders.length ? <small>({orders.length})</small> : null}</h2>
        {orders.length ? (
          orders.map((order) => (
            <div className="order-card" key={order.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <strong>{order.orderNumber}</strong>
                <span>{formatOrderStatus(order.status)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 8 }}>
                <small>{new Date(order.createdAt).toLocaleDateString()}</small>
                <small>{order.items.length} items</small>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 8 }}>
                <span>{money(order.total)}</span>
                <button
                  className="plain-button"
                  type="button"
                  onClick={() => window.alert(`${order.orderNumber}\n\n${order.items.map((item) => `${item.productName || item.name || "Item"} × ${item.quantity}`).join("\n")}\n\n${order.gstNumber ? `GST: ${order.gstNumber}\n` : ""}Total: ${money(order.total)}`)}
                >
                  View details
                </button>
              </div>
              {order.status === "CANCELLED" ? (
                <p style={{ marginTop: 12 }}><strong>Order Cancelled</strong></p>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <strong>Status timeline</strong>
                  {orderStatusTimeline.map((status, index) => {
                    const currentIndex = orderStatusIndex(order.status);
                    return (
                      <p key={status} style={{ margin: "5px 0", opacity: index <= currentIndex ? 1 : 0.5 }}>
                        {index <= currentIndex ? "✓" : "○"} {formatOrderStatus(status)}
                      </p>
                    );
                  })}
                </div>
              )}
              <p style={{ marginTop: 12 }}><strong>Current status:</strong> {formatOrderStatus(order.status)}</p>
              <p><strong>Delivery address:</strong> {orderAddressText(order.deliveryAddress) || "Not provided"}</p>
              <ul>
                {order.items.map((item, index) => (
                  <li key={`${order.id}-item-${index}`}>
                    {item.productName || item.name || "Item"} × {item.quantity} · {money(item.unitPrice ?? item.price)}
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p>No orders yet.</p>
        )}
      </section>
    </main>
  );
}
function ProfileEditor({
  customer,
  token,
  setCustomer,
}: {
  customer: Customer | null;
  token: string;
  setCustomer: (customer: Customer) => void;
}) {
  const [name, setName] = useState(customer?.name || "");
  useEffect(() => {
    setName(customer?.name || "");
  }, [customer?.name]);
  return (
    <form
      className="profile-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/api/me", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ name }),
        });
        if (response.ok) {
          const updated = (await response.json()) as Customer;
          setCustomer(updated);
          return;
        }
        const result = await response.json().catch(() => ({}));
        window.alert(result.error || "Unable to update profile");
      }}
    >
      <label>
        Full name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>
      <label>
        Mobile number
        <input value={customer?.mobile || ""} readOnly />
      </label>
      <button className="button blue">Save changes</button>
    </form>
  );
}
export default App;

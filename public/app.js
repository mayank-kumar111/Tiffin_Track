const state = {
  token: localStorage.getItem("tiffintrack_token"),
  user: null,
  customerPage: 1,
  customerTotalPages: 1,
  selectedCustomer: null,
  billMonth: "2026-09"
};

const $ = (selector) => document.querySelector(selector);

function setMessage(element, text, type = "") {
  element.textContent = text;
  element.className = `message ${type}`.trim();
  element.hidden = !text;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!headers["Content-Type"] && options.body) headers["Content-Type"] = "application/json";
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({ success: false, message: "Invalid server response" }));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Request failed (${response.status})`);
  }
  return data;
}

function showAuth(mode = "login") {
  $("#authSection").hidden = false;
  $("#dashboardSection").hidden = true;
  document.querySelectorAll(".auth-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  $("#loginForm").hidden = mode !== "login";
  $("#registerForm").hidden = mode !== "register";
  setMessage($("#authMessage"), "");
  window.location.hash = "auth";
}

function showDashboard() {
  $("#authSection").hidden = true;
  $("#dashboardSection").hidden = false;
  window.location.hash = "dashboard";
}

function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("tiffintrack_token");
}

async function loadSession() {
  if (!state.token) return false;
  try {
    const data = await api("/api/auth/me");
    state.user = data.user;
    $("#userName").textContent = data.user.name;
    showDashboard();
    await refreshDashboard();
    return true;
  } catch (error) {
    clearSession();
    return false;
  }
}

async function login(form) {
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("tiffintrack_token", data.token);
    $("#userName").textContent = data.user.name;
    showDashboard();
    await refreshDashboard();
  } catch (error) {
    setMessage($("#authMessage"), error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function register(form) {
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    const data = await api("/api/auth/register", { method: "POST", body: JSON.stringify(payload) });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("tiffintrack_token", data.token);
    $("#userName").textContent = data.user.name;
    showDashboard();
    await refreshDashboard();
  } catch (error) {
    setMessage($("#authMessage"), error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function loadCustomers() {
  const params = new URLSearchParams({
    page: String(state.customerPage),
    limit: "10",
    sort: $("#customerSort").value,
    order: $("#customerOrder").value
  });
  const search = $("#customerSearch").value.trim();
  const status = $("#customerStatus").value;
  if (search) params.set("search", search);
  if (status) params.set("status", status);

  try {
    const data = await api(`/api/customers?${params.toString()}`);
    state.customerTotalPages = data.pagination.totalPages || 1;
    $("#customerPageInfo").textContent = `Page ${data.pagination.page} of ${state.customerTotalPages}`;
    $("#customerPrev").disabled = state.customerPage <= 1;
    $("#customerNext").disabled = state.customerPage >= state.customerTotalPages;
    $("#totalCustomers").textContent = data.pagination.total;

    const tbody = $("#customerTableBody");
    if (!data.data.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No customers found.</td></tr>';
      return data;
    }

    tbody.innerHTML = data.data.map((customer) => `
      <tr>
        <td><strong>${escapeHtml(customer.name)}</strong></td>
        <td>${escapeHtml(customer.phone)}</td>
        <td><span class="status-pill status-${customer.status}">${escapeHtml(customer.status)}</span></td>
        <td><div class="table-actions">
          ${customer.status === "active" ? `<button class="small-btn" data-action="pause" data-id="${customer.id}">Pause</button>` : ""}
          ${customer.status === "paused" ? `<button class="small-btn" data-action="resume" data-id="${customer.id}">Resume</button>` : ""}
          ${customer.status === "inactive" ? `<button class="small-btn" data-action="subscribe" data-id="${customer.id}" data-name="${escapeHtml(customer.name)}" data-phone="${escapeHtml(customer.phone)}">Subscribe</button>` : ""}
          <button class="small-btn" data-action="bill" data-id="${customer.id}">Bill</button>
        </div></td>
      </tr>
    `).join("");
    return data;
  } catch (error) {
    $("#customerTableBody").innerHTML = `<tr><td colspan="4" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function loadBills() {
  try {
    const data = await api(`/api/bills?month=${encodeURIComponent(state.billMonth)}&page=1&limit=50&sort=amount&order=desc`);
    const tbody = $("#billTableBody");
    if (!data.bills.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No billable subscriptions found.</td></tr>';
      $("#totalBilling").textContent = "₹0.00";
      return;
    }
    tbody.innerHTML = data.bills.map((bill) => `
      <tr>
        <td><strong>${escapeHtml(bill.name)}</strong><div class="muted">${escapeHtml(bill.plan_name)}</div></td>
        <td>${bill.served_days}</td>
        <td>${bill.paused_days}</td>
        <td><strong>₹${Number(bill.amount).toFixed(2)}</strong></td>
      </tr>
    `).join("");
    const total = data.bills.reduce((sum, bill) => sum + Number(bill.amount), 0);
    $("#totalBilling").textContent = `₹${total.toFixed(2)}`;
  } catch (error) {
    $("#billTableBody").innerHTML = `<tr><td colspan="4" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function refreshStatusMetrics() {
  try {
    const active = await api("/api/customers?status=active&page=1&limit=1");
    const paused = await api("/api/customers?status=paused&page=1&limit=1");
    $("#activeCustomers").textContent = active.pagination.total;
    $("#pausedCustomers").textContent = paused.pagination.total;
  } catch {
    $("#activeCustomers").textContent = "—";
    $("#pausedCustomers").textContent = "—";
  }
}

async function refreshDashboard() {
  await Promise.all([loadCustomers(), loadBills(), refreshStatusMetrics()]);
}

async function pauseCustomer(customerId) {
  const pauseStart = prompt("Pause start date (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
  if (!pauseStart) return;
  try {
    await api(`/api/customers/${customerId}/pause`, { method: "POST", body: JSON.stringify({ pauseStart }) });
    await refreshDashboard();
  } catch (error) {
    alert(error.message);
  }
}

async function resumeCustomer(customerId) {
  const resumeDate = prompt("Resume date (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
  if (!resumeDate) return;
  try {
    await api(`/api/customers/${customerId}/resume`, { method: "POST", body: JSON.stringify({ resumeDate }) });
    await refreshDashboard();
  } catch (error) {
    alert(error.message);
  }
}

async function showBill(customerId) {
  try {
    const data = await api(`/api/customers/${customerId}/bill?month=${encodeURIComponent(state.billMonth)}`);
    alert(`${data.customer.name}\n\n${data.billing.served_days} served weekdays\n${data.billing.paused_days} paused weekdays\nBill: ₹${Number(data.billing.amount).toFixed(2)}`);
  } catch (error) {
    alert(error.message);
  }
}

async function createCustomer(form) {
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    await api("/api/customers", { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    $("#customerDialog").close();
    await refreshDashboard();
  } catch (error) {
    setMessage($("#customerFormMessage"), error.message, "error");
  }
}

function openSubscription(customer) {
  state.selectedCustomer = customer;
  $("#subscriptionCustomerId").value = customer.id;
  $("#subscriptionCustomerName").textContent = `${customer.name} • ${customer.phone}`;
  $("#subscriptionForm").querySelector('[name="startDate"]').value = new Date().toISOString().slice(0, 10);
  setMessage($("#subscriptionFormMessage"), "");
  $("#subscriptionDialog").showModal();
}

async function createSubscription(form) {
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.customerId = Number(payload.customerId);
    payload.monthlyPrice = Number(payload.monthlyPrice);
    await api("/api/subscriptions", { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    $("#subscriptionDialog").close();
    await refreshDashboard();
  } catch (error) {
    setMessage($("#subscriptionFormMessage"), error.message, "error");
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

$("#navLoginBtn").addEventListener("click", () => showAuth("login"));
$("#navRegisterBtn").addEventListener("click", () => showAuth("register"));
$("#heroLoginBtn").addEventListener("click", () => showAuth("login"));
$("#heroRegisterBtn").addEventListener("click", () => showAuth("register"));

$("#logoutBtn").addEventListener("click", () => {
  clearSession();
  showAuth("login");
});

document.querySelectorAll(".auth-tab").forEach((tab) => tab.addEventListener("click", () => showAuth(tab.dataset.mode)));
$("#loginForm").addEventListener("submit", (event) => { event.preventDefault(); login(event.currentTarget); });
$("#registerForm").addEventListener("submit", (event) => { event.preventDefault(); register(event.currentTarget); });

$("#customerSearch").addEventListener("input", () => { state.customerPage = 1; loadCustomers(); });
$("#customerStatus").addEventListener("change", () => { state.customerPage = 1; loadCustomers(); });
$("#customerSort").addEventListener("change", () => { state.customerPage = 1; loadCustomers(); });
$("#customerOrder").addEventListener("change", () => { state.customerPage = 1; loadCustomers(); });
$("#customerPrev").addEventListener("click", () => { if (state.customerPage > 1) { state.customerPage -= 1; loadCustomers(); } });
$("#customerNext").addEventListener("click", () => { if (state.customerPage < state.customerTotalPages) { state.customerPage += 1; loadCustomers(); } });
$("#billMonth").addEventListener("change", (event) => { state.billMonth = event.target.value; loadBills(); });
$("#newCustomerBtn").addEventListener("click", () => { $("#customerForm").reset(); setMessage($("#customerFormMessage"), ""); $("#customerDialog").showModal(); });
$("#customerForm").addEventListener("submit", (event) => { event.preventDefault(); createCustomer(event.currentTarget); });
$("#subscriptionForm").addEventListener("submit", (event) => { event.preventDefault(); createSubscription(event.currentTarget); });

$("#customerTableBody").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const customerId = Number(button.dataset.id);
  if (button.dataset.action === "pause") await pauseCustomer(customerId);
  if (button.dataset.action === "resume") await resumeCustomer(customerId);
  if (button.dataset.action === "subscribe") {
    openSubscription({ id: customerId, name: button.dataset.name, phone: button.dataset.phone });
  }
  if (button.dataset.action === "bill") await showBill(customerId);
});

loadSession();

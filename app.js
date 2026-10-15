(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const ASK = "Tanyakan admin";
  const CAT = {
    streaming: "Streaming",
    "editing-design": "Editing & desain",
    "utility-ai": "Utilitas & AI",
  };

  // Small DOM helper: builds nodes with textContent only (no innerHTML).
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null) n.append(c);
    return n;
  }

  let D; // validated data
  const state = { q: "", cat: "all" };

  let currentView = "home";

  const VIEW_SECTIONS = {
    home: ["#home", "#contact"],
    pricelist: ["#products"],
    rules: ["#rules", "#faq"],
  };
  function showView(view, historyMode = "push") {
    if (!VIEW_SECTIONS[view]) view = "home";

    // Sembunyikan bagian dari tampilan sebelumnya.
    const visibleSections = new Set(VIEW_SECTIONS[view]);

    Object.values(VIEW_SECTIONS)
      .flat()
      .forEach((selector) => {
        const section = $(selector);
        if (section) section.hidden = !visibleSections.has(selector);
      });

    currentView = view;

    // Tandai menu yang sedang aktif.
    $("#nav")
      .querySelectorAll("a[data-view]")
      .forEach((link) => {
        if (link.dataset.view === view) {
          link.setAttribute("aria-current", "page");
        } else {
          link.removeAttribute("aria-current");
        }
      });

    // Perbarui URL agar navigasi bisa diingat browser.
    const url = `#${view}`;

    if (historyMode === "push" && location.hash !== url) {
      history.pushState(null, "", url);
    } else if (historyMode === "replace" && location.hash !== url) {
      history.replaceState(null, "", url);
    }

    // Setiap tampilan dimulai dari bagian atas.
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  /* ---------- data ---------- */
  const okUrl = (u) => {
    try {
      const x = new URL(u);
      return x.protocol === "https:" && x.hostname === "wa.me";
    } catch {
      return false;
    }
  };

  async function loadData() {
    const get = (n) =>
      fetch(`${n}.json`).then((r) => {
        if (!r.ok) throw new Error(`${n}.json: HTTP ${r.status}`);
        return r.json();
      });
    const [a, p, r, s] = await Promise.all(
      ["apps", "pricing", "rules", "site"].map(get),
    );
    const apps = a.apps;
    const byId = new Map(apps.map((x) => [x.id, x]));
    const plans = p.plans.filter(
      (x) =>
        byId.has(x.app_id) ||
        (console.warn("Plan tanpa aplikasi:", x.id), false),
    );
    const rules = r.rules.filter(
      (x) =>
        !x.app_id ||
        byId.has(x.app_id) ||
        (console.warn("Aturan tanpa aplikasi:", x.id), false),
    );
    const ruleMap = new Map(rules.map((x) => [x.id, x]));
    const faq = (r.faq || []).filter(
      (x) =>
        ruleMap.has(x.rule_id) ||
        (console.warn("FAQ tanpa aturan:", x.id), false),
    );
    const contacts = s.contacts.filter(
      (x) =>
        okUrl(x.url) || (console.warn("URL kontak tidak valid:", x.id), false),
    );
    return {
      apps,
      byId,
      plans,
      rules,
      ruleMap,
      faq,
      contacts,
      site: s,
      meta: r._meta || {},
    };
  }

  /* ---------- formatting ---------- */
  const plansOf = (id) => D.plans.filter((p) => p.app_id === id);
  const planLabel = (p) => {
    let l = p.plan_label;
    if (p.duration.status === "ambiguous")
      l = l.replace(p.duration.raw, "").trim(); // unconfirmed abbreviation is not shown
    return l || "Paket";
  };
  const durText = (p) =>
    p.duration.status === "stated" ? p.duration.raw : ASK;
  const priceText = (p) =>
    p.price.display ? "Rp\u00a0" + p.price.display : ASK;
  const priceNum = (p) => p.price.amount_idr ?? p.price.min_idr ?? null;
  const initials = (n) => {
    const w = n.split(/\s+/);
    return (w.length > 1 ? w[0][0] + w[1][0] : n.slice(0, 2)).toUpperCase();
  };
  const sentence = (t) => {
    t = t.toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  function fromPrice(ps) {
    const priced = ps.filter((p) => priceNum(p) != null);
    if (!priced.length) return ASK;
    const low = priced.reduce((m, p) => (priceNum(p) < priceNum(m) ? p : m));
    const text =
      "Rp " +
      (low.price.min_idr != null
        ? low.price.display.split(" ")[0]
        : low.price.display);
    return ps.length > 1 || low.price.min_idr != null ? "dari " + text : text;
  }

  /* ---------- catalog ---------- */
  const mono = (app) => {
    const iconPath = app.icon?.source_image;

    if (!iconPath) {
      return el("span", {
        class: "mono",
        "aria-hidden": "true",
        text: initials(app.name),
      });
    }

    const logo = el("img", {
      class: "app-logo",
      src: iconPath,
      alt: "",
      loading: "lazy",
    });

    logo.addEventListener(
      "error",
      () => {
        console.error("Logo gagal dimuat:", iconPath);
        logo.replaceWith(
          el("span", {
            class: "mono",
            "aria-hidden": "true",
            text: initials(app.name),
          }),
        );
      },
      { once: true },
    );

    return logo;
  };
  function row(app) {
    const amt = fromPrice(plansOf(app.id));
    return el(
      "li",
      {},
      el(
        "button",
        {
          class: "row",
          type: "button",
          "aria-haspopup": "dialog",
          onclick: () => openApp(app.id),
        },
        mono(app),
        el(
          "span",
          { class: "nm" },
          el("span", { class: "name", text: app.name }),
          el("span", {
            class: "cat",
            text: CAT[app.category.value] || app.category.value,
          }),
        ),
        el("span", { class: "leader", "aria-hidden": "true" }),
        el("span", { class: "amt" + (amt === ASK ? " ask" : ""), text: amt }),
      ),
    );
  }

  function renderCatalog() {
    const q = state.q.toLowerCase().replace(/\s+/g, "");
    const list = D.apps.filter(
      (a) =>
        (state.cat === "all" || a.category.value === state.cat) &&
        (!q ||
          (a.name + a.name_source)
            .toLowerCase()
            .replace(/\s+/g, "")
            .includes(q)),
    );
    $("#catalog").replaceChildren(...list.map(row));
    $("#count").textContent = `${list.length} dari ${D.apps.length} aplikasi`;
    $("#empty").hidden = list.length > 0;
  }

  function renderChips() {
    const cats = [...new Set(D.apps.map((a) => a.category.value))];
    const box = $("#chips");
    const make = (value, label) =>
      el("button", {
        type: "button",
        "aria-pressed": String(state.cat === value),
        "data-cat": value,
        text: label,
        onclick: () => {
          state.cat = value;
          renderChips();
          renderCatalog();
        },
      });
    box.replaceChildren(
      make("all", "Semua"),
      ...cats.map((c) => make(c, CAT[c] || c)),
    );
  }

  /* ---------- pricing ---------- */
  function planTable(ps, name) {
    return el(
      "table",
      {},
      el("caption", { class: "sr", text: "Paket dan harga " + name }),
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", { scope: "col", text: "Paket" }),
          el("th", { scope: "col", text: "Durasi" }),
          el("th", { scope: "col", class: "num", text: "Harga" }),
        ),
      ),
      el(
        "tbody",
        {},
        ps.map((p) =>
          el(
            "tr",
            {},
            el(
              "th",
              { scope: "row", class: "plan" },
              planLabel(p),
              p.conditions.length
                ? el(
                    "ul",
                    { class: "cond" },
                    p.conditions.map((c) => el("li", { text: c })),
                  )
                : null,
              p.availability
                ? el("p", { class: "cond", text: p.availability })
                : null,
            ),
            el("td", {
              class: durText(p) === ASK ? "ask" : "",
              text: durText(p),
            }),
            el("td", {
              class: "num" + (priceText(p) === ASK ? " ask" : ""),
              text: priceText(p),
            }),
          ),
        ),
      ),
    );
  }

  /* ---------- rules + FAQ ---------- */
  const list = (head, items) =>
    items && items.length
      ? [
          el("h4", { text: head }),
          el(
            "ul",
            {},
            items.map((i) => el("li", { text: i })),
          ),
        ]
      : [];

  function ruleBody(r) {
    const content = [];

    (r.blocks || []).forEach((b) => {
      content.push(
        el("h4", { text: cap(b.heading) }),
        el("p", { text: b.definition }),
        list("Kelebihan", b.advantages),
        list("Kekurangan", b.disadvantages),
      );
    });

    (r.paragraphs || []).forEach((t) => {
      content.push(el("p", { text: t }));
    });

    if (r.bullets && r.bullets.length) {
      content.push(
        el("ul", {}, ...r.bullets.map((t) => el("li", { text: t }))),
      );
    }

    return el("div", { class: "abody" }, ...content);
  }
  function renderRules() {
    const intro = D.meta.section_intro_source;
    $("#rules-intro").textContent = intro || "";

    const box = $("#rules-list");

    const item = (r, prefix, label) =>
      el(
        "details",
        { id: prefix + r.id },
        el("summary", { text: label }),
        ruleBody(r),
      );

    const general = D.rules.filter((r) => r.scope === "general");
    const perApp = D.rules.filter((r) => r.scope === "app");

    box.replaceChildren(
      ...[
        general.length ? el("h3", { class: "rg", text: "Aturan umum" }) : null,

        ...general.map((r) => item(r, "rule-", sentence(r.title))),

        perApp.length
          ? el("h3", { class: "rg", text: "Aturan per aplikasi" })
          : null,

        ...perApp.map((r) =>
          item(
            r,
            "rule-",
            `${D.byId.get(r.app_id)?.name || r.app_id}: ${sentence(r.title)}`,
          ),
        ),
      ].filter(Boolean),
    );
  }

  function goRule(id) {
    const d = document.getElementById("rule-" + id);
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ block: "start" });
    d.querySelector("summary").focus({ preventScroll: true });
  }

  /* ---------- dialog + WhatsApp ---------- */
  function waLink(contact, app, plan) {
    const label = planLabel(plan);
    const tpl = D.site.proposed_by_designer.order_message_template;
    const msg = (label === "Paket" ? tpl.replace(" - {plan}", "") : tpl)
      .replace("{app}", app.name)
      .replace("{plan}", label);
    return `${contact.url}?text=${encodeURIComponent(msg)}`;
  }

  function openApp(id, planId) {
    const app = D.byId.get(id);
    if (!app) return;
    const ps = plansOf(id);
    const dlg = $("#detail");
    $("#d-title").textContent = app.name;
    const links = D.contacts.map((c) =>
      el("a", {
        class: "btn",
        target: "_blank",
        rel: "noopener noreferrer",
        text: c.label,
      }),
    );
    const sel = el(
      "select",
      { id: "plan-sel" },
      ps.map((p) =>
        el("option", {
          value: p.id,
          text: `${planLabel(p)} (${priceText(p)})`,
        }),
      ),
    );
    const sync = () => {
      const plan = ps.find((p) => p.id === sel.value) || ps[0];
      links.forEach((a, i) => (a.href = waLink(D.contacts[i], app, plan)));
    };
    sel.addEventListener("change", sync);
    if (planId) sel.value = planId;
    sync();

    const rules = D.rules.filter((r) => r.app_id === id);
    $("#d-body").replaceChildren(
      ...[
        el("p", {
          class: "meta",
          text: CAT[app.category.value] || app.category.value,
        }),
        el("h3", { text: "Fitur dan catatan" }),
        app.features.length
          ? el(
              "ul",
              { class: "feat" },
              app.features.map((f) => el("li", { text: f })),
            )
          : el("p", {
              class: "ask",
              text: "Tidak ada catatan fitur di daftar admin.",
            }),
        el("h3", { text: "Paket dan harga" }),
        planTable(ps, app.name),
        ps.some((p) => durText(p) === ASK)
          ? el("p", {
              class: "hint",
              text: 'Durasi bertuliskan "Tanyakan admin" belum tercantum di daftar. Tanyakan ke admin sebelum order.',
            })
          : null,
        rules.map((r) =>
          el(
            "p",
            {},
            el("button", {
              class: "link",
              type: "button",
              text: "Baca aturan: " + sentence(r.title),
              onclick: () => {
                dlg.close();
                goRule(r.id);
              },
            }),
          ),
        ),
        el("h3", { text: "Pesan lewat WhatsApp" }),
        el("label", { class: "lbl", for: "plan-sel", text: "Pilih paket" }),
        sel,
        el("p", {
          class: "hint",
          text: "Pilih admin untuk membuka WhatsApp dengan pesan yang sudah terisi.",
        }),
        el(
          "ul",
          { class: "admins" },
          links.map((a) => el("li", {}, a)),
        ),
      ]
        .flat()
        .filter(Boolean),
    );
    dlg.showModal();
    dlg.scrollTop = 0;
    history.replaceState(null, "", "#app-" + id);
  }

  /* ---------- init ---------- */
  function renderSite() {
    const { brand, proposed_by_designer: pd } = D.site;

    // Paksa nama brand menjadi Mattheo.
    document.querySelectorAll("[data-brand]").forEach((n) => {
      n.textContent = "Mattheo";
    });

    document.title = `Mattheo | ${brand.tagline}`;

    $("#tagline").textContent = brand.tagline;
    $("#welcome").replaceChildren(
      ...brand.welcome.map((t) => el("span", { text: t })),
    );

    $("#disclaimer").textContent = pd.footer_disclaimer;
    $("#copyright").textContent = pd.footer_copyright;

    $("#contact-list").replaceChildren(
      ...D.contacts.map((c) =>
        el(
          "li",
          {},
          el("a", {
            class: "btn",
            href: c.url,
            target: "_blank",
            rel: "noopener noreferrer",
            text: c.label,
          }),
        ),
      ),
    );

    $("#foot-contacts").replaceChildren(
      ...D.contacts.map((c) =>
        el(
          "li",
          {},
          el("a", {
            href: c.url,
            target: "_blank",
            rel: "noopener noreferrer",
            text: c.label,
          }),
        ),
      ),
    );

    const avail = D.ruleMap.get("rule-admin-availability");

    if (avail) {
      $("#contact-note").replaceChildren(
        el("p", {}, el("strong", { text: sentence(avail.title) })),
        ...avail.paragraphs.map((t) => el("p", { text: t })),
      );
    }
  }

  function bindUi() {
    $("#q").addEventListener("input", (e) => {
      state.q = e.target.value;
      renderCatalog();
    });

    $("#reset").addEventListener("click", () => {
      state.q = "";
      state.cat = "all";
      $("#q").value = "";
      renderChips();
      renderCatalog();
      $("#q").focus();
    });

    const dlg = $("#detail");
    const top = $("#top");
    const btn = $(".menu");
    const nav = $("#nav");

    const setNav = (open) => {
      top.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
    };

    btn.addEventListener("click", () => {
      setNav(!top.classList.contains("open"));
    });

    document.addEventListener("click", (e) => {
      const link = e.target.closest("a[data-view]");
      if (!link) return;

      e.preventDefault();
      showView(link.dataset.view);
      setNav(false);
    });

    $("#d-close").addEventListener("click", () => dlg.close());

    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });

    dlg.addEventListener("close", () => {
      history.replaceState(null, "", `#${currentView}`);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && top.classList.contains("open")) {
        setNav(false);
        btn.focus();
      }
    });
  }

  async function init() {
    bindUi();

    try {
      D = await loadData();
    } catch (err) {
      console.error(err);

      const s = $("#status");
      s.setAttribute("role", "alert");
      s.textContent =
        "Data tidak bisa dimuat. Jalankan website melalui server lokal, misalnya Live Server.";
      return;
    }

    $("#status").hidden = true;

    renderSite();
    renderChips();
    renderCatalog();
    renderRules();

    showView("home", "replace");
    openFromHash();

    window.addEventListener("hashchange", openFromHash);
    window.addEventListener("popstate", openFromHash);
  }

  function openFromHash() {
    const hash = location.hash;

    const match = hash.match(/^#app-(.+)$/);

    if (match && D.byId.has(match[1])) {
      if (!$("#detail").open) {
        openApp(match[1]);
      }
      return;
    }

    const view = hash.slice(1);

    if (VIEW_SECTIONS[view]) {
      if ($("#detail").open) {
        $("#detail").close();
      }

      showView(view, "replace");
    } else {
      showView("home", "replace");
    }
  }

  init();
})();

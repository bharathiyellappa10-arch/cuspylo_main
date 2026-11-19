const $ = s => document.querySelector(s), A = $('#app');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

let cfg = { slots: [], price: 50, defaultPrice: 50 };
let token = localStorage.t || '';
let role = localStorage.r || '';
let user = JSON.parse(localStorage.u || 'null');

let cart = (()=>{try{const x=JSON.parse(localStorage.cart||'[]');return Array.isArray(x)?x.filter(i=>i&&typeof i==='object'&&Number(i.product_id)>0).map(i=>({product_id:Number(i.product_id),name:String(i.name||'Product'),price:Number(i.price)||0,quantity:Math.max(0,Number(i.quantity)||0),image:String(i.image||'')})):[]}catch{return[]}})();
let after = 'dash';
let timer;
let authWatch;
// Cached wishlist IDs keep heart states consistent across cards and page refreshes.
let wishlistKeys = new Set();
let appliedCoupon = null;
let wishlistStateLoadedFor = '';
const wishlistKey = (type, id) => `${type}:${String(id)}`;
const applyWishlistHeartState = (root = document) => {
  root.querySelectorAll?.('[data-wishlist-product], [data-wishlist-kit]').forEach(button => {
    const type = button.hasAttribute('data-wishlist-kit') ? 'kit' : 'product';
    const id = button.getAttribute(type === 'kit' ? 'data-wishlist-kit' : 'data-wishlist-product');
    const saved = wishlistKeys.has(wishlistKey(type, id));
    button.textContent = saved ? '♥' : '♡';
    button.classList.toggle('is-saved', saved);
    button.setAttribute('aria-pressed', saved ? 'true' : 'false');
    button.setAttribute('aria-label', saved ? 'Remove from wishlist' : 'Add to wishlist');
    button.title = saved ? 'Remove from wishlist' : 'Add to wishlist';
  });
};
const loadWishlistState = async (force = false) => {
  if (role !== 'user' || !token) { wishlistKeys = new Set(); wishlistStateLoadedFor = ''; return; }
  const identity = token;
  if (!force && wishlistStateLoadedFor === identity) { applyWishlistHeartState(A); return; }
  try {
    const data = await api('/wishlist');
    wishlistKeys = new Set((data.items || []).map(item => wishlistKey(item.item_type, item.item_type === 'kit' ? item.kit_id : item.product_id)));
    wishlistStateLoadedFor = identity;
    applyWishlistHeartState(A);
  } catch (e) {
    // Keep the storefront usable if wishlist is temporarily unavailable.
    console.warn('Wishlist state could not be loaded:', e.message);
  }
};

const api = async (p, b) => {
  const r = await fetch('/api' + p, {
    method: b ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token
    },
    body: b ? JSON.stringify(b) : undefined
  });

  const d = await r.json().catch(() => ({}));

  if (!r.ok) { if ((r.status === 401 || r.status === 403) && role === 'user') { token = role = ''; user = null; ['t','r','u'].forEach(k => localStorage.removeItem(k)); head(); go('auth'); toast(d.error || 'Your session is no longer active.'); } throw new Error(d.error || 'Something went wrong'); }

  return d;
};

const toast = m => {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    document.body.appendChild(t);
  }
  t.textContent = String(m ?? '');
  Object.assign(t.style, {
    position: 'fixed',
    left: '50%',
    bottom: '28px',
    transform: 'translate(-50%, 12px)',
    zIndex: '2147483647',
    maxWidth: 'min( calc(100vw - 32px), 420px)',
    padding: '13px 20px',
    borderRadius: '12px',
    background: '#123c3a',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '600',
    lineHeight: '1.4',
    textAlign: 'center',
    boxShadow: '0 8px 28px rgba(0,0,0,.24)',
    opacity: '1',
    visibility: 'visible',
    pointerEvents: 'none',
    transition: 'opacity .2s ease, transform .2s ease'
  });
  t.classList.add('on');
  clearTimeout(t._toastTimer);
  requestAnimationFrame(() => { t.style.transform = 'translate(-50%, 0)'; });
  t._toastTimer = setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translate(-50%, 12px)';
    setTimeout(() => { t.classList.remove('on'); t.style.visibility = 'hidden'; }, 220);
  }, 2600);
};

const hr = h => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');

const saveCart = () => {
  localStorage.cart = JSON.stringify(cart);
  $('#cc').textContent = cart.reduce((n,x)=>n+Number(x.quantity||1),0);
};

// Buy Now keeps the customer's existing cart separate from this checkout.
const BUY_NOW_CART_KEY = 'cuspylo_buy_now_original_cart';
const startBuyNow = product => {
  if (!product) return;
  if (!sessionStorage.getItem(BUY_NOW_CART_KEY)) {
    sessionStorage.setItem(BUY_NOW_CART_KEY, JSON.stringify(cart));
  }
  cart = [{
    product_id: Number(product.id),
    name: String(product.name || 'Product'),
    price: Number(product.price || 0),
    quantity: 1,
    image: Array.isArray(product.multi_images) && product.multi_images.length
      ? product.multi_images[0]
      : (product.image_data || '')
  }];
  appliedCoupon = null;
  saveCart();
  go('cart');
};
const finishBuyNowOrder = () => {
  const saved = sessionStorage.getItem(BUY_NOW_CART_KEY);
  if (saved !== null) {
    try {
      const original = JSON.parse(saved);
      cart = Array.isArray(original) ? original : [];
    } catch {
      cart = [];
    }
    sessionStorage.removeItem(BUY_NOW_CART_KEY);
  } else {
    cart = [];
  }
  appliedCoupon = null;
  saveCart();
};

const setAuth = (d, r) => {
  token = d.token;
  role = r;
  user = d.user || null;

  localStorage.t = token;
  localStorage.r = r;
  localStorage.u = JSON.stringify(user);
  localStorage.seen = 1;

  head();
};

const logout = () => {
  token = role = '';
  user = null;

  ['t', 'r', 'u'].forEach(k => localStorage.removeItem(k));

  head();
  go('home');
};

const head = () => {
  $('#who').innerHTML = role
    ? `<button class="btn sm alt" onclick="go('account')">${esc(role === 'admin' ? 'Admin' : (user?.name || 'Account'))}</button>
       <button class="btn sm" onclick="logout()">Log out</button>`
    : `<button class="btn sm" onclick="go('auth')">Sign in</button>`;
};


// SITE NAVIGATION DRAWER
function toggleMenu() {
  const drawer = $('#site-drawer');
  const overlay = $('#menu-overlay');
  const toggle = $('.menu-toggle');
  if (!drawer || !overlay || !toggle) return;
  const opening = !drawer.classList.contains('open');
  drawer.classList.toggle('open', opening);
  overlay.classList.toggle('open', opening);
  drawer.setAttribute('aria-hidden', String(!opening));
  overlay.setAttribute('aria-hidden', String(!opening));
  toggle.setAttribute('aria-expanded', String(opening));
  document.body.classList.toggle('menu-open', opening);
}

function closeMenu() {
  const drawer = $('#site-drawer');
  const overlay = $('#menu-overlay');
  const toggle = $('.menu-toggle');
  if (drawer) {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
  }
  if (overlay) {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  }
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('menu-open');
}

function navigateMenu(destination) {
  closeMenu();
  go(destination);
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMenu();
});


function dismissFounder() {
  localStorage.seen = '1';
  go('auth');
}

function go(v) {
  closeMenu();

  if (v === 'admin') {
    sessionStorage.setItem('cuspylo_view', 'admin');
    window.location.href = '/admin-console.html';
    return;
  }

  sessionStorage.setItem('cuspylo_view', v);

  clearInterval(timer);
  scrollTo(0, 0);

  if (v === 'dash' && !role) localStorage.seen = '1';

  const rendered = (views[v] || views.home)();
  Promise.resolve(rendered).then(() => {
    // Keep the three primary shortcuts mounted on every app view, not only the dashboard.
    let quickNav = document.getElementById('cuspylo-global-bottom-nav');
    if (!quickNav) {
      quickNav = document.createElement('nav');
      quickNav.id = 'cuspylo-global-bottom-nav';
      quickNav.className = 'dashboard-bottom-nav';
      quickNav.setAttribute('aria-label', 'Quick navigation');
      quickNav.innerHTML = `<button type="button" onclick="go('dash')">⌂ <span>Home</span></button><button type="button" onclick="go('account')">♙ <span>Account</span></button><button type="button" onclick="go('store')">▣ <span>Store</span></button>`;
    }
    // Remove the old dashboard-only instance to prevent duplicate bars.
    A.querySelectorAll('.dashboard-bottom-nav:not(#cuspylo-global-bottom-nav)').forEach(node => node.remove());

    // The founder welcome message is a focused modal: never show floating
    // Home / Account / Store navigation over or beneath it.
    const founderIsOpen = !!A.querySelector('.founder-backdrop');
    if (founderIsOpen) {
      quickNav.remove();
    } else if (A && !quickNav.isConnected) {
      A.appendChild(quickNav);
    }
    loadWishlistState();
  }).catch(error => console.warn('Page render:', error));
  saveCart();
}


function openCatalogueItem(product) {
  if (!product) return;
  const id = Number(product.id);
  history.pushState({cuspyloProduct:id}, '', `?product=${encodeURIComponent(id)}`);
  sessionStorage.setItem('cuspylo_view','product-detail');
  renderProductDetail(product);
}

async function renderProductDetail(product) {
  if (!product) return go('store');
  clearInterval(timer);
  A.innerHTML = `<section class="sec glass product-detail-page"><button class="text-action" type="button" id="product-detail-back">← Back</button><div class="product-detail-loading">Loading product details…</div></section>`;
  $('#product-detail-back').onclick=()=>history.back();
  const isResource = !['Dental Store'].includes(product.product_type) && product.store_group!=='OTHER_ESSENTIALS';
  let reviewData={reviews:[]};
  if (!isResource) {
    try { const rr=await fetch(`/api/products/${product.id}/reviews`); if(rr.ok) reviewData=await rr.json(); } catch {}
  }
  const reviews=reviewData.reviews||[];
  const avg=reviews.length?reviews.reduce((n,r)=>n+Number(r.rating||0),0)/reviews.length:0;
  const stars=n=>'★'.repeat(Math.max(0,Math.min(5,Math.round(n))))+'☆'.repeat(5-Math.max(0,Math.min(5,Math.round(n))));
  const images=Array.isArray(product.multi_images)&&product.multi_images.length?product.multi_images:(product.image_data?[product.image_data]:[]);
  const price=Number(product.price||0);
  A.innerHTML=`<section class="sec glass product-detail-page">
    <button class="text-action" type="button" id="product-detail-back">← Back</button>
    <div class="product-detail-layout">
      <div class="product-detail-gallery">${images.length?`<img class="product-detail-main-image" src="${esc(images[0])}" alt="${esc(product.name)}">`:'<div class="product-detail-image-placeholder">CUSPYLO</div>'}
        ${images.length>1?`<div class="product-detail-thumbs">${images.map((im,i)=>`<button type="button" data-detail-image="${i}"><img src="${esc(im)}" alt="Product view ${i+1}"></button>`).join('')}</div>`:''}</div>
      <div class="product-detail-info"><span class="poster-tag">${esc(product.product_type||'DENTAL STORE')}</span><h1>${esc(product.name)}</h1>
        ${!isResource?`<div class="product-detail-rating"><strong>${avg?avg.toFixed(1):'New'}</strong><span>${stars(avg)}</span><small>${reviews.length} published review${reviews.length===1?'':'s'}</small></div>`:''}
        <div class="product-detail-price">${price===0?'FREE':`₹${price.toLocaleString('en-IN')}`}</div>
        <p class="mut">${esc(product.academic_year||'Universal')} · ${esc(product.subject||product.category||'CUSPYLO')}</p>
        <p class="product-detail-stock">${Number(product.stock_quantity)>0?`${product.stock_quantity} in stock`:'Available to order'}</p>
        <p>${esc(product.description||'No additional description provided.')}</p>
        ${product.quality_note?`<p>${esc(product.quality_note)}</p>`:''}
        ${!isResource?`<div class="product-detail-actions"><button class="btn teal" id="detail-add-cart">Add to cart</button><button class="btn product-buy-now-btn" id="detail-buy-now">Buy now</button></div>`:
          `<div class="product-detail-actions">${product.has_pdf?`<button class="btn teal" id="detail-resource-action">${price===0?'Download PDF':'Preview PDF'}</button>`:'<span class="mut">PDF coming soon</span>'}</div>`}
      </div>
    </div>
    ${!isResource?`<section class="product-detail-reviews" id="product-detail-reviews"><h2>Customer ratings & reviews</h2><div class="product-review-summary"><strong>${avg?avg.toFixed(1)+'/5':'No ratings yet'}</strong><span>${stars(avg)}</span><small>${reviews.length} published reviews</small></div>
      ${[5,4,3,2,1].map(n=>{const c=reviews.filter(r=>Number(r.rating)===n).length;return `<div class="product-rating-bar"><span>${n} star</span><span><i style="width:${reviews.length?c/reviews.length*100:0}%"></i></span><small>${c}</small></div>`}).join('')}
      <div class="product-review-list">${reviews.length?reviews.map(r=>`<article class="product-review"><div><strong>${esc(r.reviewer_name||r.customer_name||'CUSPYLO customer')}</strong><span>${stars(Number(r.rating))}</span></div><p>${esc(r.review_text||'')}</p>${r.created_at?`<small>${new Date(r.created_at).toLocaleDateString('en-IN')}</small>`:''}</article>`).join(''):'<p class="mut">No published reviews yet. Reviews from delivered orders will appear here after approval.</p>'}</div></section>`:''}
  </section>`;
  $('#product-detail-back').onclick=()=>history.back();
  A.querySelectorAll('[data-detail-image]').forEach(b=>b.onclick=()=>{const im=images[Number(b.dataset.detailImage)];const main=$('.product-detail-main-image');if(main)main.src=im;});
  if(!isResource){
    $('#detail-add-cart').onclick=()=>{const found=cart.find(x=>x.product_id===Number(product.id));if(found)found.quantity=Math.min(99,found.quantity+1);else cart.push({product_id:Number(product.id),name:product.name,price,quantity:1,image:images[0]||''});saveCart();toast('Item added to cart');};
    $('#detail-buy-now').onclick=()=>startBuyNow(product);
  } else if(product.has_pdf){
    $('#detail-resource-action').onclick=async()=>{try{const mode=price===0?'download':'preview';const r=await fetch(`/api/resources/${product.id}/pdf?mode=${mode}`,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('Unable to open this PDF.');const blob=await r.blob(),url=URL.createObjectURL(blob);if(mode==='download'){const a=document.createElement('a');a.href=url;a.download=product.pdf_filename||`${product.name}.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}else{const w=window.open(url,'_blank');if(!w)toast('Allow pop-ups to preview this PDF.');}}catch(e){toast(e.message);}};
  }
}

// PAGE VIEWS


const ACADEMIC_SUBJECTS = {
  '1st Year': ['DADH','Biochemistry','Physiology','General Anatomy'],
  '2nd Year': ['Pharmacology','Dental Materials','Microbiology','General Pathology'],
  '3rd Year': ['Oral Pathology','Periodontology','Oral Medicine'],
  '4th Year': ['Prosthodontics','Endodontics','Orthodontics','Oral Surgery']
};

async function showAcademicResources(productType, pageTitle, pageDescription) {
  if (role !== 'user') { after = productType === 'PYQs' ? 'pyqs' : productType === 'Notes' ? 'notes' : 'mindmaps'; return go('auth'); }
  A.innerHTML = `
    <section class="sec glass academic-resource-page">
      <button class="text-action" type="button" onclick="go('dash')">← Dashboard</button>
      <span class="poster-tag">CUSPYLO ACADEMICS</span>
      <h1>${esc(pageTitle)}</h1>
      <p>${esc(pageDescription)}</p>
      <div class="academic-resource-filters">
        <label>Academic year
          <select id="resource-year">
            <option value="">All years</option>
            <option>1st Year</option><option>2nd Year</option>
            <option>3rd Year</option><option>4th Year</option>
          </select>
        </label>
        <label>Subject
          <select id="resource-subject"><option value="">All subjects</option></select>
        </label>
      </div>
      <div id="academic-resource-list" class="academic-resource-grid">Loading resources…</div>
    </section>
    <div id="resource-pdf-modal" class="resource-pdf-modal" hidden>
      <div class="resource-pdf-dialog" role="dialog" aria-modal="true" aria-label="PDF preview">
        <div class="resource-pdf-heading">
          <strong id="resource-pdf-title">Resource preview</strong>
          <button type="button" class="btn alt" id="resource-pdf-close">Close ×</button>
        </div>
        <p id="resource-pdf-note" class="mut"></p>
        <iframe id="resource-pdf-frame" title="PDF preview"></iframe>
      </div>
    </div>`;

  const host = $('#academic-resource-list');
  const year = $('#resource-year');
  const subject = $('#resource-subject');
  let products = [];
  let currentPdfUrl = '';

  const updateSubjects = () => {
    const available = ACADEMIC_SUBJECTS[year.value] || [];
    subject.innerHTML = '<option value="">All subjects</option>' +
      available.map(x => `<option>${esc(x)}</option>`).join('');
  };

  const closePdf = () => {
    const modal = $('#resource-pdf-modal');
    if (modal) modal.hidden = true;
    const frame = $('#resource-pdf-frame');
    if (frame) frame.src = 'about:blank';
    if (currentPdfUrl) URL.revokeObjectURL(currentPdfUrl);
    currentPdfUrl = '';
  };

  $('#resource-pdf-close').onclick = closePdf;
  $('#resource-pdf-modal').addEventListener('click', e => {
    if (e.target.id === 'resource-pdf-modal') closePdf();
  });

  const openPdf = async (product, mode) => {
    try {
      const response = await fetch(`/api/resources/${product.id}/pdf?mode=${mode}`, {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => ({}));
        throw new Error(problem.error || 'Unable to open this PDF.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      if (mode === 'download') {
        const link = document.createElement('a');
        link.href = url;
        link.download = product.pdf_filename || `${product.name}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        toast('Your free PDF download has started.');
      } else {
        if (currentPdfUrl) URL.revokeObjectURL(currentPdfUrl);
        currentPdfUrl = url;
        $('#resource-pdf-title').textContent = product.name;
        $('#resource-pdf-note').textContent = 'Preview limited to the first 2 pages.';
        $('#resource-pdf-frame').src = url;
        $('#resource-pdf-modal').hidden = false;
      }
    } catch (error) {
      toast(error.message);
    }
  };

  const render = () => {
    const list = products.filter(p =>
      p.product_type === productType &&
      (!year.value || p.academic_year === 'Universal' || p.academic_year === year.value) &&
      (!subject.value || p.subject === 'Universal' || p.subject === subject.value)
    );

    host.innerHTML = list.length ? list.map(p => {
      const isFree = Number(p.price) === 0;
      const priceLabel = isFree ? 'FREE' : `₹${Number(p.price).toLocaleString('en-IN')}`;
      return `
        <article class="academic-resource-card">
          <div class="academic-resource-card-top">
            ${p.image_data
              ? `<img class="academic-resource-cover" data-open-resource="${p.id}" src="${esc(p.image_data)}" alt="${esc(p.name)}">`
              : `<div class="academic-resource-cover-placeholder" aria-hidden="true"><span>PDF</span><i>▤</i></div>`}
            <span class="academic-resource-type">${isFree ? 'FREE RESOURCE' : 'PAID RESOURCE'}</span>
          </div>
          <div class="academic-resource-card-body">
            <div class="academic-resource-meta">
              <span>${esc(p.academic_year || 'Universal')}</span>
              <span>${esc(p.subject || 'Universal')}</span>
            </div>
            <h3>${esc(p.name)}</h3>
            ${p.description ? `<p class="academic-resource-description">${esc(p.description)}</p>` : ''}
            <div class="academic-resource-card-footer">
              <div class="academic-resource-price-block">
                <small>PRICE</small>
                <strong>${priceLabel}</strong>
              </div>
              <span class="academic-resource-file-state ${p.has_pdf ? 'is-ready' : 'is-pending'}">
                ${p.has_pdf ? 'PDF available' : 'PDF coming soon'}
              </span>
            </div>
            <div class="academic-resource-actions">
              ${!p.has_pdf
                ? '<span class="academic-resource-unavailable">This resource is not available yet</span>'
                : isFree
                  ? `<button class="btn teal" type="button" data-resource-download="${p.id}">Download PDF</button>`
                  : `<button class="btn alt" type="button" data-resource-preview="${p.id}">Preview 2 pages</button>
                     <button class="btn teal" type="button" data-resource-cart="${p.id}">Add to cart</button>`}
            </div>
          </div>
        </article>
      `;
    }).join('') : '<p class="mut academic-resource-empty">No resources found for these filters yet.</p>';

    host.querySelectorAll('[data-open-resource]').forEach(node=>{node.style.cursor='pointer';node.onclick=()=>openCatalogueItem(products.find(x=>String(x.id)===node.dataset.openResource));});host.querySelectorAll('[data-resource-download]').forEach(button => button.onclick = () => {
      const p = list.find(x => String(x.id) === button.dataset.resourceDownload);
      if (p?.has_pdf) openPdf(p, 'download'); else toast('PDF is not available yet.');
    });
    host.querySelectorAll('[data-resource-preview]').forEach(button => button.onclick = () => {
      const p = list.find(x => String(x.id) === button.dataset.resourcePreview);
      if (p?.has_pdf) openPdf(p, 'preview'); else toast('PDF is not available yet.');
    });
    host.querySelectorAll('[data-resource-cart]').forEach(button => button.onclick = () => {
      const p = list.find(x => String(x.id) === button.dataset.resourceCart);
      if (!p) return;
      const existing = cart.find(x => Number(x.product_id) === Number(p.id));
      if (existing) existing.quantity = Math.min(99, Number(existing.quantity || 0) + 1);
      else cart.push({product_id:Number(p.id),name:p.name,price:Number(p.price),quantity:1,image:p.image_data||''});
      saveCart();
      toast(`${productType === 'PYQs' ? 'PYQs' : productType} added to cart`);
    });
  };

  year.onchange = () => { updateSubjects(); render(); };
  subject.onchange = render;

  try {
    const response = await fetch('/api/products');
    if (!response.ok) throw new Error('Unable to load academic resources.');
    const data = await response.json();
    products = (data.products || []).filter(p => p.product_type === productType);
    updateSubjects();
    render();
  } catch (error) {
    host.textContent = error.message;
  }
}

const views = {

  // HOME

  
home() {
  if (role === 'user') return go('dash');
  if (role === 'admin') return go('admin');

  // Returning visitors who are not signed in go to login.
  if (localStorage.seen) return go('auth');

  A.innerHTML = `
    <div class="founder-backdrop">
      <section class="glass founder founder-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="founder-heading">

        <img src="logo.png" alt="CUSPYLO"
          style="width:min(100%,300px);margin-bottom:18px">

        <h1 id="founder-heading">
          ${esc(SITE.founderTitle)}
        </h1>

        <p>${esc(SITE.founderNote)}</p>

        <div class="row">
          <button class="btn teal"
            onclick="dismissFounder('auth')">
            Sign in
          </button>
        </div>

      </section>
    </div>
  `;
},


  // LOGIN, SIGNUP AND ACCOUNT RECOVERY
  auth(mode = 'login') {
    const su = mode === 'signup';
    const questionOptions = `
      <option value="">Choose a security question</option>
      <option value="favourite_place">What is your favourite place in the world?</option>
      <option value="favourite_word">What is your favourite English word?</option>
      <option value="first_school">What was the name of your first school?</option>
      <option value="fictional_character">Who is your favourite fictional character?</option>
      <option value="childhood_nickname">What was your childhood nickname?</option>
      <option value="childhood_memory">What is a memorable childhood memory?</option>`;
    A.innerHTML = `
      <section class="glass auth-card" style="max-width:500px;margin:5vh auto">
        <h2>${su ? 'Create your student account' : 'Welcome back'}</h2>
        <p class="mut">${su ? 'Register with your mobile number and email address.' : 'Sign in using your registered email or mobile number.'}</p><br>
        <form id="af">
          ${su ? `
            <label for="signup-name">Full name</label><input id="signup-name" name="name" autocomplete="name" placeholder="Full name" maxlength="80" required>
            <label for="signup-phone">Mobile number</label><input id="signup-phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="10-digit mobile number" maxlength="15" required>
            <label for="signup-email">Email address</label><input id="signup-email" name="email" type="email" autocomplete="email" placeholder="Email address" maxlength="120" required>
            <label for="signup-college">College</label><input id="signup-college" name="college" placeholder="College name" maxlength="120" required>
            <label for="signup-year">Academic year</label>
            <select id="signup-year" name="academicYear" required><option value="">Select your year</option><option value="1st Year">1st Year</option><option value="2nd Year">2nd Year</option><option value="3rd Year">3rd Year</option><option value="4th Year">4th Year</option><option value="Internship">Internship</option><option value="Other">Other</option></select>
            <h3 style="margin-top:20px">Account recovery setup</h3><p class="mut">Choose three different questions. Your answers will help verify your identity if you forget your password.</p>
            <label>Security question 1</label><select name="securityQuestion1" required>${questionOptions}</select><label>Answer 1</label><input name="securityAnswer1" maxlength="120" autocomplete="off" required>
            <label>Security question 2</label><select name="securityQuestion2" required>${questionOptions}</select><label>Answer 2</label><input name="securityAnswer2" maxlength="120" autocomplete="off" required>
            <label>Security question 3</label><select name="securityQuestion3" required>${questionOptions}</select><label>Answer 3</label><input name="securityAnswer3" maxlength="120" autocomplete="off" required>
            <label for="signup-password">Create password</label><input id="signup-password" name="password" type="password" autocomplete="new-password" placeholder="Create a strong password" minlength="8" required>
            <div class="password-meter" aria-live="polite"><div class="password-meter-track"><span id="password-meter-fill"></span></div><p id="password-strength" class="mut">Password strength: Not entered</p><p class="password-hint">Use at least 8 characters and at least 3 of: lowercase, uppercase, number, symbol.</p></div>
            <label for="signup-confirm">Confirm password</label><input id="signup-confirm" name="confirmPassword" type="password" autocomplete="new-password" placeholder="Re-enter password" minlength="8" required><p id="password-match" class="mut" aria-live="polite"></p>
          ` : `
            <label for="login-identifier">Email or mobile number</label><input id="login-identifier" name="identifier" autocomplete="username" placeholder="Registered email or mobile number" required>
            <label for="login-password">Password</label><input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Password" required>
            <p id="login-error" class="login-error" role="alert" aria-live="assertive" hidden></p>
            <p class="mut" style="text-align:right"><a href="#" id="forgot-password-link">Forgot password?</a></p>
          `}
          <button class="btn" style="width:100%" id="auth-submit">${su ? 'Create account' : 'Sign in'}</button>
        </form>
        <p class="mut c" style="margin-top:14px">${su ? 'Already registered?' : 'New to CUSPYLO?'} <a href="#" onclick="views.auth('${su ? 'login' : 'signup'}');return false">${su ? 'Sign in' : 'Create account'}</a></p>
      </section>`;

    if (!su) $('#forgot-password-link').onclick = e => { e.preventDefault(); views.forgotPassword(); };
    if (su) {
      const pw = $('#signup-password'), confirm = $('#signup-confirm');
      const fill = $('#password-meter-fill'), label = $('#password-strength'), match = $('#password-match');
      const update = () => {
        const v = pw.value;
        const types = [/[a-z]/.test(v), /[A-Z]/.test(v), /\d/.test(v), /[^A-Za-z0-9]/.test(v)].filter(Boolean).length;
        const score = !v ? 0 : v.length >= 8 && types >= 4 ? 4 : v.length >= 8 && types >= 3 ? 3 : v.length >= 8 && types >= 2 ? 2 : 1;
        const words = ['Not entered', 'Weak', 'Fair', 'Good', 'Strong'];
        label.textContent = 'Password strength: ' + words[score]; fill.style.width = (score * 25) + '%'; fill.dataset.level = words[score].toLowerCase();
        match.textContent = !confirm.value ? '' : v === confirm.value ? 'Passwords match.' : 'Passwords do not match.';
        match.className = 'mut ' + (!confirm.value ? '' : v === confirm.value ? 'password-match-ok' : 'password-match-error');
      };
      pw.addEventListener('input', update); confirm.addEventListener('input', update);
    }

    $('#af').onsubmit = async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      if (su) {
        if (new Set([data.securityQuestion1, data.securityQuestion2, data.securityQuestion3]).size !== 3) return toast('Choose three different security questions.');
        if (data.password !== data.confirmPassword) return toast('Passwords do not match.');
        const types = [/[a-z]/.test(data.password), /[A-Z]/.test(data.password), /\d/.test(data.password), /[^A-Za-z0-9]/.test(data.password)].filter(Boolean).length;
        if (data.password.length < 8 || types < 3) return toast('Use at least 8 characters and 3 character types.');
      }
      const button = $('#auth-submit'); button.disabled = true; button.textContent = su ? 'Creating account…' : 'Signing in…';
      const loginError = !su ? $('#login-error') : null;
      if (loginError) { loginError.hidden = true; loginError.textContent = ''; }
      try {
        const result = await api(su ? '/signup' : '/login', data);
        setAuth(result, 'user');
        toast(su ? 'Account created' : 'Signed in');
        if (!result.user?.recoveryConfigured) views.setupRecovery();
        else { go(after); after = 'dash'; }
      } catch (err) {
        if (loginError) { loginError.textContent = err.message || 'Incorrect email/mobile number or password. Please try again.'; loginError.hidden = false; }
        else toast(err.message);
        button.disabled = false; button.textContent = su ? 'Create account' : 'Sign in';
      }
    };
  },

  async setupRecovery() {
    const questionOptions = `
      <option value="">Choose a security question</option>
      <option value="favourite_place">What is your favourite place in the world?</option>
      <option value="favourite_word">What is your favourite English word?</option>
      <option value="first_school">What was the name of your first school?</option>
      <option value="fictional_character">Who is your favourite fictional character?</option>
      <option value="childhood_nickname">What was your childhood nickname?</option>
      <option value="childhood_memory">What is a memorable childhood memory?</option>`;
    A.innerHTML = `<section class="glass auth-card" style="max-width:500px;margin:5vh auto"><h2>Set up account recovery</h2><p class="mut">Before continuing, choose three security questions. You will need the answers if you forget your password.</p><form id="recovery-setup-form">
      ${[1,2,3].map(i => `<label>Security question ${i}</label><select name="securityQuestion${i}" required>${questionOptions}</select><label>Answer ${i}</label><input name="securityAnswer${i}" maxlength="120" autocomplete="off" required>`).join('')}
      <button class="btn" style="width:100%;margin-top:16px">Save recovery questions</button></form></section>`;
    $('#recovery-setup-form').onsubmit = async e => {
      e.preventDefault(); const data = Object.fromEntries(new FormData(e.target));
      if (new Set([data.securityQuestion1,data.securityQuestion2,data.securityQuestion3]).size !== 3) return toast('Choose three different questions.');
      try { await api('/password-recovery/setup', data); toast('Recovery questions saved'); go('dash'); }
      catch (err) { toast(err.message); }
    };
  },

  async forgotPassword() {
    A.innerHTML = `<section class="glass auth-card" style="max-width:500px;margin:5vh auto"><h2>Reset your password</h2><p class="mut">Enter the email address registered with your Cuspylo account.</p><form id="recovery-email-form"><label>Email address</label><input name="email" type="email" autocomplete="email" required><button class="btn" style="width:100%;margin-top:16px">Continue</button></form><p class="mut c"><a href="#" onclick="views.auth('login');return false">Back to login</a></p></section>`;
    $('#recovery-email-form').onsubmit = async e => {
      e.preventDefault(); const email = new FormData(e.target).get('email');
      try {
        const data = await api('/password-recovery/questions', { email });
        views.answerRecovery(email, data.questions);
      } catch (err) { toast(err.message); }
    };
  },

  answerRecovery(email, questions) {
    A.innerHTML = `<section class="glass auth-card" style="max-width:500px;margin:5vh auto"><h2>Verify your identity</h2><p class="mut">Answer all three questions exactly as you entered them when creating your account.</p><form id="recovery-answer-form">${questions.map((q,i) => `<label>${esc(q.question)}</label><input name="answer${i+1}" autocomplete="off" required>`).join('')}<button class="btn" style="width:100%;margin-top:16px">Verify answers</button></form><p class="mut c"><a href="#" onclick="views.auth('login');return false">Back to login</a></p></section>`;
    $('#recovery-answer-form').onsubmit = async e => {
      e.preventDefault(); const values = Object.fromEntries(new FormData(e.target));
      const answers = questions.map((q,i) => ({ questionId:q.id, answer:values['answer'+(i+1)] }));
      try { const data = await api('/password-recovery/verify', { email, answers }); views.resetPassword(data.resetToken); }
      catch (err) { toast(err.message); }
    };
  },

  resetPassword(resetToken) {
    A.innerHTML = `<section class="glass auth-card" style="max-width:500px;margin:5vh auto"><h2>Create a new password</h2><p class="mut">Your identity has been verified. Choose a strong new password.</p><form id="new-password-form"><label>New password</label><input name="password" type="password" minlength="8" autocomplete="new-password" required><label>Confirm new password</label><input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required><button class="btn" style="width:100%;margin-top:16px">Update password</button></form></section>`;
    $('#new-password-form').onsubmit = async e => {
      e.preventDefault(); const data = Object.fromEntries(new FormData(e.target));
      try { await api('/password-recovery/reset', { ...data, resetToken }); toast('Password updated. Please sign in.'); views.auth('login'); }
      catch (err) { toast(err.message); }
    };
  },

  // DASHBOARD

  dash() {
    A.innerHTML = `
      <section class="home-universal-search">
        <div class="home-search-heading"><span class="eyebrow">CUSPYLO STUDENT HUB</span><h1>What are you looking for?</h1><p>Search products, notes, PYQs, mind maps and more.</p></div>
        <div class="home-search-wrap"><span aria-hidden="true">⌕</span><input id="home-universal-query" type="search" autocomplete="off" placeholder="Search products, subjects, notes, PYQs..." aria-label="Search all Cuspylo"><button id="home-universal-clear" type="button" aria-label="Clear search">×</button></div>
        <div id="home-search-results" class="home-search-results" hidden></div>
      </section>
      <section class="home-promo-carousel" aria-label="Featured promotions">
        <div class="home-promo-track" id="home-promo-track"><div class="home-promo-fallback">Discover Dental Store, Notes and Mind Maps on Cuspylo</div></div>
        <button class="home-promo-arrow home-promo-prev" id="home-promo-prev" type="button" aria-label="Previous promotion">‹</button>
        <button class="home-promo-arrow home-promo-next" id="home-promo-next" type="button" aria-label="Next promotion">›</button>
        <div class="home-promo-dots" id="home-promo-dots"></div>
      </section>
      <section class="home-dashboard-section"><div class="home-dashboard-heading"><h2>Explore Cuspylo</h2><p>Everything you need for your dental journey.</p></div>
        <div class="grid">${SITE.dashboard.map(t => `<button class="tile ${t.live ? '' : 'off'}" onclick="${t.live ? `go('${t.view || 'store'}')` : "toast(SITE.comingSoon)"}"><img class="tile-image" src="${t.image}" alt="${esc(t.title)}"><h3>${esc(t.title)}</h3><span>${esc(t.sub)}</span></button>`).join('')}</div>
      </section>
      <section class="sell-cuspylo-banner"><div><span class="eyebrow">CUSPYLO COMMUNITY MARKETPLACE</span><h2>Sell on Cuspylo</h2><p>Give your pre-owned dental products a second life. List your products and reach fellow students.</p></div><button class="btn teal" onclick="go('sell')">List My Product →</button></section>`;
    const input = $('#home-universal-query'), results = $('#home-search-results');
    const clear = $('#home-universal-clear');
    let catalogue = [];
    const kind = p => {
      const t=String(p.product_type||'').toLowerCase(), g=String(p.store_group||'').toLowerCase();
      if (t.includes('note')) return 'Notes';
      if (t.includes('pyq') || t.includes('question')) return 'PYQs';
      if (t.includes('mind')) return 'Mind Maps';
      if (t.includes('quiz')) return 'Quiz';
      if (t.includes('dental') || g==='other_essentials' || p.store_group==='OTHER_ESSENTIALS') return 'Dental Store';
      return p.product_type || 'Resources';
    };
    const score=(p,q)=>{
      const hay=[p.name,p.description,p.subject,p.academic_year,p.category,p.sku,p.search_keywords,p.product_type,p.store_group].join(' ').toLowerCase();
      const words=q.toLowerCase().trim().split(/\s+/).filter(Boolean);
      return words.every(w=>hay.includes(w)) ? words.reduce((n,w)=>n+(String(p.name||'').toLowerCase().includes(w)?4:1),0) : 0;
    };
    const render=()=>{
      const q=input.value.trim();
      clear.hidden=!q;
      if(!q){results.hidden=true;results.innerHTML='';return;}
      const matches=catalogue.filter(p=>p.active!==false && score(p,q)>0).sort((a,b)=>score(b,q)-score(a,q)).slice(0,12);
      results.hidden=false;
      results.innerHTML=matches.length?matches.map(p=>`<button type="button" class="home-search-result" data-open-search-item="${p.id}"><span class="home-search-result-thumb">${p.image_data?`<img src="${esc(p.image_data)}" alt="">`:'<span>▤</span>'}</span><span class="home-search-result-copy"><strong>${esc(p.name)}</strong><small>${esc(kind(p))} · ${esc(p.subject||p.academic_year||'CUSPYLO')}</small></span><span class="home-search-result-arrow">›</span></button>`).join(''):'<p class="home-search-empty">No matching items found. Try another keyword.</p>';
      results.querySelectorAll('[data-open-search-item]').forEach(b=>b.onclick=()=>openCatalogueItem(catalogue.find(p=>String(p.id)===b.dataset.openSearchItem)));
    };
    input.addEventListener('input',render);
    clear.onclick=()=>{input.value='';render();input.focus();};
    fetch('/api/products').then(r=>{if(!r.ok)throw Error();return r.json();}).then(d=>{catalogue=d.products||[];render();}).catch(()=>{results.innerHTML='<p class="home-search-empty">Search is temporarily unavailable.</p>';});
    let promoSlides=[], promoIndex=0, promoTimer=null;
    const track=$('#home-promo-track'), dots=$('#home-promo-dots');
    const drawPromos=()=>{
      if(!promoSlides.length){track.innerHTML='<div class="home-promo-fallback">Discover Dental Store, Notes and Mind Maps on Cuspylo</div>';dots.innerHTML='';return;}
      track.innerHTML=promoSlides.map((s,i)=>`<button class="home-promo-slide ${i===promoIndex?'active':''}" type="button" data-promo-index="${i}" aria-label="Open ${esc(s.title||s.destination)}"><img src="${esc(s.image_data)}" alt="${esc(s.title||'Cuspylo promotion')}"></button>`).join('');
      dots.innerHTML=promoSlides.map((s,i)=>`<button type="button" class="${i===promoIndex?'active':''}" data-promo-dot="${i}" aria-label="Show promotion ${i+1}"></button>`).join('');
      track.querySelectorAll('[data-promo-index]').forEach(b=>b.onclick=()=>{const s=promoSlides[Number(b.dataset.promoIndex)];go(s.destination);});
      dots.querySelectorAll('[data-promo-dot]').forEach(b=>b.onclick=()=>{promoIndex=Number(b.dataset.promoDot);drawPromos();resetPromoTimer();});
    };
    const movePromo=delta=>{if(!promoSlides.length)return;promoIndex=(promoIndex+delta+promoSlides.length)%promoSlides.length;drawPromos();};
    const resetPromoTimer=()=>{clearInterval(promoTimer);if(promoSlides.length>1)promoTimer=setInterval(()=>movePromo(1),7000);};
    $('#home-promo-prev').onclick=()=>{movePromo(-1);resetPromoTimer();};
    $('#home-promo-next').onclick=()=>{movePromo(1);resetPromoTimer();};
    fetch('/api/homepage-posts').then(r=>r.ok?r.json():{slides:[]}).then(d=>{promoSlides=(d.slides||[]).filter(s=>s.image_data);drawPromos();resetPromoTimer();}).catch(()=>drawPromos());
    let touchX=0;
    track.addEventListener('touchstart',e=>{touchX=e.changedTouches[0].clientX;},{passive:true});
    track.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-touchX;if(Math.abs(dx)>45){movePromo(dx<0?1:-1);resetPromoTimer();}},{passive:true});
    track.addEventListener('mouseenter',()=>clearInterval(promoTimer));
    track.addEventListener('mouseleave',resetPromoTimer);
  },


  // DENTAL STORE — catalogue-first commerce (no FDI/jaw selector)
  async store() {
    A.innerHTML=`<section class="sec glass store-hero"><span class="poster-tag">MADE FOR DENTAL STUDENTS</span><h1>Dental Store</h1><p>Your dental era starts here. 🦷 Shop the instruments, materials and kits you need to ace every practical.</p></section>
      <section class="store-filter-panel"><div class="store-search-wrap"><input id="store-search" autocomplete="off" placeholder="Search products… e.g. lab coat"><div id="store-suggestions" class="store-suggestions" hidden></div></div><div class="store-filter-row"><select id="store-group" aria-label="Product category"><option value="">All categories</option><option value="DENTAL_STORE">Dental</option><option value="OTHER_ESSENTIALS">Others</option></select><select id="store-year" aria-label="Academic year"><option value="">All years</option><option>1st Year</option><option>2nd Year</option><option>3rd Year</option><option>4th Year</option><option>Universal</option></select><select id="store-subject" aria-label="Subject"><option value="">All subjects</option></select></div></section>
      <section class="sec store-discovery-wrap"><div class="store-discovery-rail" aria-label="Explore Dental Store collections">
        <button class="store-discovery-card" type="button" data-discovery="kits"><span class="store-discovery-kicker">CURATED FOR YOUR YEAR</span><strong>Yearly Kits</strong><small>Choose year · choose subject</small><span class="store-discovery-arrow">Swipe / Explore →</span></button>
        <button class="store-discovery-card" type="button" data-discovery="new"><span class="store-discovery-kicker">JUST ADDED</span><strong>New Arrivals</strong><small>Explore the latest products</small><span class="store-discovery-arrow">Swipe / Explore →</span></button>
        <button class="store-discovery-card" type="button" data-discovery="best"><span class="store-discovery-kicker">STUDENT FAVOURITES</span><strong>Best Sellers</strong><small>Popular products by sales</small><span class="store-discovery-arrow">Swipe / Explore →</span></button>
      </div><p class="store-swipe-hint">← Swipe sideways to explore all collections →</p></section>
      <section class="sec glass store-discovery-panel" id="panel-kits" hidden style="display:none!important"><div class="row store-panel-heading"><div><h2>Yearly Kits</h2><p class="mut">Choose your academic year and subject.</p></div><button class="btn alt" type="button" data-close-discovery>Close ×</button></div><div class="kit-filter-row"><select id="kit-year-filter" aria-label="Filter kits by year"><option value="">All years</option><option>1st Year</option><option>2nd Year</option><option>3rd Year</option><option>4th Year</option></select><select id="kit-subject-filter" aria-label="Filter kits by subject"><option value="">All subjects</option></select><select id="kit-type-filter" aria-label="Filter kits by type"><option value="">All kit types</option><option value="CUSTOMIZABLE">Customizable</option><option value="PREMIUM">Premium</option><option value="HIGH_PERFORMANCE">High Performance</option><option value="BALANCED">Balanced</option><option value="ECONOMY">Low Cost / Economy</option></select></div><div id="store-kits" class="catalogue-grid store-rail">Loading kits…</div></section>
      <section class="sec glass store-discovery-panel" id="panel-new" hidden style="display:none!important"><div class="row store-panel-heading"><h2>New Arrivals</h2><button class="btn alt" type="button" data-close-discovery>Close ×</button></div><div id="store-new" class="catalogue-grid store-rail">Loading…</div></section>
      <section class="sec glass store-discovery-panel" id="panel-best" hidden style="display:none!important"><div class="row store-panel-heading"><h2>Best Sellers</h2><button class="btn alt" type="button" data-close-discovery>Close ×</button></div><div id="store-best" class="catalogue-grid store-rail">Sales ranking will appear as order data accumulates.</div></section>
      <section class="sec glass"><div class="row store-products-heading"><h2>All Dental Products</h2><select id="store-sort" aria-label="Sort products by price"><option value="">Sort by price</option><option value="low-high">Price: Low to High</option><option value="high-low">Price: High to Low</option></select></div><div id="store-products" class="catalogue-grid">Loading products…</div><button id="store-more" class="btn alt" style="margin-top:14px">Show more</button></section>
      <section class="sec glass"><h2>Can't find a product? Request it</h2><form id="rf"><input name="product" placeholder="Product name" required><label class="mut">Product image (optional)</label><input type="file" name="img" accept="image/png,image/jpeg,image/webp"><p class="mut">We will contact you about availability.</p><button class="btn teal">Send product request</button></form></section>`;
    const years=['1st Year','2nd Year','3rd Year','4th Year'];
    const subjects={'1st Year':['DADH','Biochemistry','Physiology','General Anatomy'],'2nd Year':['Pharmacology','Dental Materials','Microbiology','General Pathology'],'3rd Year':['Oral Pathology','Periodontology','Oral Medicine'],'4th Year':['Prosthodontics','Endodontics','Orthodontics','Oral Surgery']};
    const y=$('#store-year'),sub=$('#store-subject'),q=$('#store-search'),suggestions=$('#store-suggestions'),group=$('#store-group'),host=$('#store-products'),sort=$('#store-sort');
    const refreshSubjects=()=>{const old=sub.value;sub.innerHTML='<option value="">All subjects</option>'+((subjects[y.value]||[]).map(v=>`<option>${esc(v)}</option>`).join(''));if((subjects[y.value]||[]).includes(old))sub.value=old;};
    const imageList=p=>Array.isArray(p.multi_images)&&p.multi_images.length?p.multi_images:(p.image_data?[p.image_data]:[]);
    const card=p=>{const imgs=imageList(p);return `<article class="catalogue-card"><button class="wishlist-heart" type="button" data-wishlist-product="${p.id}" aria-label="Add to wishlist" title="Add to wishlist">♡</button><div class="product-gallery" data-open-product="${p.id}" role="button" tabindex="0">${imgs.length?`<img data-main-product="${p.id}" src="${esc(imgs[0])}" alt="${esc(p.name)}">`:'<div class="product-placeholder">Dental product</div>'}${imgs.length>1?`<div class="product-thumbs">${imgs.slice(0,5).map((im,i)=>`<button type="button" data-gallery-image="${esc(im)}" data-gallery-product="${p.id}"><img src="${esc(im)}" alt="${esc(p.name)} view ${i+1}"></button>`).join('')}</div>`:''}</div><small>${esc(p.category||'Dental Store')} · ${esc(p.academic_year||'Universal')}</small><h3 data-open-product="${p.id}" class="product-card-title">${esc(p.name)}</h3>${p.sold_by_user?'<span class="sold-by-user-badge">SOLD BY USER</span>':''}<p>${esc(p.description||'')}</p><p class="mut">${esc(p.subject||'Universal')}${p.quality_note?` · ${esc(p.quality_note)}`:''}</p><div class="product-buy-row"><div><b class="product-price">₹${Number(p.price||0).toLocaleString('en-IN')}</b><p class="mut">${Number(p.stock_quantity)>0?`${p.stock_quantity} in stock`:'Available to order'}</p></div><div class="product-action-buttons"><button type="button" class="btn teal product-add-btn" data-add-product="${p.id}">Add to cart</button><button type="button" class="btn product-buy-now-btn" data-buy-now="${p.id}">Buy now</button></div></div><div class="catalogue-reviews" data-reviews-for="${p.id}">Reviews</div></article>`;};
    let all=[];let shown=12;
    const editDistance=(a,b)=>{if(Math.abs(a.length-b.length)>2)return 99;let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const cur=[i];for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur;}return prev[b.length];};
    const searchScore=(p,query)=>{if(!query.trim())return 1;const fields=[p.name,p.description,p.sku,p.category,p.subject,p.academic_year,p.search_keywords].join(' ').toLowerCase();const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean);let score=0;for(const w of words){if(fields.includes(w)){score+=w.length>2?3:1;continue;}const candidates=fields.split(/[^a-z0-9]+/).filter(Boolean);if(candidates.some(t=>t.length>3&&editDistance(w,t)<=1))score+=1;else return 0;}if(String(p.name||'').toLowerCase().startsWith(query.toLowerCase()))score+=5;return score;};
    const render=()=>{let list=all.filter(p=>(!group.value||p.store_group===group.value)&&(!y.value||p.academic_year==='Universal'||p.academic_year===y.value)&&(!sub.value||p.subject==='Universal'||p.subject===sub.value)&&searchScore(p,q.value)>0);if(q.value.trim())list.sort((a,b)=>searchScore(b,q.value)-searchScore(a,q.value));if(sort?.value==='low-high')list.sort((a,b)=>Number(a.price||0)-Number(b.price||0));else if(sort?.value==='high-low')list.sort((a,b)=>Number(b.price||0)-Number(a.price||0));const view=list.slice(0,shown);host.innerHTML=view.length?view.map(card).join(''):'<p class="mut">No matching products. Try another search or filter.</p>';applyWishlistHeartState(host);$('#store-more').hidden=view.length>=list.length;host.querySelectorAll('[data-add-product]').forEach(b=>b.onclick=()=>{const p=all.find(x=>String(x.id)===b.dataset.addProduct);addProductToCart(p);});host.querySelectorAll('[data-buy-now]').forEach(b=>b.onclick=()=>startBuyNow(all.find(x=>String(x.id)===b.dataset.buyNow)));host.querySelectorAll('[data-gallery-image]').forEach(b=>b.onclick=()=>{const img=host.querySelector(`[data-main-product="${b.dataset.galleryProduct}"]`);if(img)img.src=b.dataset.galleryImage;});host.querySelectorAll('[data-open-product]').forEach(el=>{el.onclick=e=>{if(e.target.closest('button'))return;openCatalogueItem(all.find(x=>String(x.id)===el.dataset.openProduct));};el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCatalogueItem(all.find(x=>String(x.id)===el.dataset.openProduct));}};});host.querySelectorAll('[data-reviews-for]').forEach(async box=>{try{const r=await fetch(`/api/products/${box.dataset.reviewsFor}/reviews`);const d=await r.json();box.innerHTML=(d.reviews||[]).length?(d.reviews||[]).map(v=>`<p class="mut"><b>${'★'.repeat(Number(v.rating))}</b> ${esc(v.review_text||'')}</p>`).join(''):'<small class="mut">No published reviews yet</small>';}catch{box.textContent='Reviews unavailable';}});};
    const addProductToCart=p=>{if(!p)return;const found=cart.find(x=>x.product_id===Number(p.id));if(found)found.quantity=Math.min(99,found.quantity+1);else cart.push({product_id:Number(p.id),name:p.name,price:Number(p.price),quantity:1,image:imageList(p)[0]||''});saveCart();toast('Item added to cart');};
    const bindCards=el=>{el.querySelectorAll('[data-add-product]').forEach(b=>b.onclick=()=>addProductToCart(all.find(x=>String(x.id)===b.dataset.addProduct)));el.querySelectorAll('[data-buy-now]').forEach(b=>b.onclick=()=>startBuyNow(all.find(x=>String(x.id)===b.dataset.buyNow)));el.querySelectorAll('[data-gallery-image]').forEach(b=>b.onclick=()=>{const img=el.querySelector(`[data-main-product="${b.dataset.galleryProduct}"]`);if(img)img.src=b.dataset.galleryImage;});el.querySelectorAll('[data-open-product]').forEach(node=>{node.onclick=e=>{if(e.target.closest('button'))return;openCatalogueItem(all.find(x=>String(x.id)===node.dataset.openProduct));};node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCatalogueItem(all.find(x=>String(x.id)===node.dataset.openProduct));}};});el.querySelectorAll('[data-reviews-for]').forEach(async box=>{try{const r=await fetch(`/api/products/${box.dataset.reviewsFor}/reviews`);const d=await r.json();box.innerHTML=(d.reviews||[]).length?(d.reviews||[]).map(v=>`<p class="mut"><b>${'★'.repeat(Number(v.rating))}</b> ${esc(v.review_text||'')}</p>`).join(''):'<small class="mut">No published reviews yet</small>';}catch{box.textContent='Reviews unavailable';}});};
    try{
      const [pd,kd]=await Promise.all([fetch('/api/products').then(r=>r.json()),fetch('/api/kits').then(r=>r.json())]);
      all=(pd.products||[]).filter(p=>p.product_type==='Dental Store'||p.store_group==='OTHER_ESSENTIALS');
      const kitHost=$('#store-kits'),kitYear=$('#kit-year-filter'),kitSubject=$('#kit-subject-filter'),kitType=$('#kit-type-filter');const kitSubjects={'1st Year':['DADH','Biochemistry','Physiology','General Anatomy'],'2nd Year':['Pharmacology','Dental Materials','Microbiology','General Pathology'],'3rd Year':['Oral Pathology','Periodontology','Oral Medicine'],'4th Year':['Prosthodontics','Endodontics','Orthodontics','Oral Surgery']};const renderKits = () => {
  const oldSubject = kitSubject.value;

  kitSubject.innerHTML =
    '<option value="">All subjects</option>' +
    (kitSubjects[kitYear.value] || [])
      .map(v => `<option>${esc(v)}</option>`)
      .join('');

  if ((kitSubjects[kitYear.value] || []).includes(oldSubject)) {
    kitSubject.value = oldSubject;
  }

  const list = (kd.kits || []).filter(k =>
    (!kitYear.value ||
      k.academic_year === 'Universal' ||
      k.academic_year === kitYear.value) &&
    (!kitSubject.value ||
      k.subject === 'Universal' ||
      k.subject === kitSubject.value) &&
    (!kitType.value ||
      String(k.kit_type || '').toUpperCase() === kitType.value)
  );

  kitHost.innerHTML = list.length
    ? list.map(k => `
      <article class="catalogue-card kit-card">
        <button class="wishlist-heart" type="button" data-wishlist-kit="${k.id}" aria-label="Add to wishlist" title="Add to wishlist">♡</button>
        <small>${esc(k.academic_year)} · ${esc(k.subject || 'Universal')}</small>
        <h3>${esc(k.name)}</h3>
        <p>${esc(k.description || '')}</p>
        <p class="mut">${esc(String(k.kit_type || '').replaceAll('_', ' '))}</p>

        <ul>
          ${(k.items || []).map(i =>
            `<li>${esc(i.name)} × ${i.quantity}</li>`
          ).join('')}
        </ul>

        ${k.quality_disclosure
          ? `<p class="mut"><b>Specifications:</b> ${esc(k.quality_disclosure)}</p>`
          : ''}

        <div class="kit-buy-row">
          <b>₹${Number(k.total_price ?? (k.items || []).reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0)).toLocaleString('en-IN')}</b>
          <button class="btn alt" type="button"
            data-customize-kit="${k.id}">
            Customize Kit
          </button>
        </div>

        <div class="kit-editor" id="kit-editor-${k.id}" hidden>
          <h4>Customize your kit</h4>
          <p class="mut">Increase or decrease the quantity of each item.</p>

          <div data-kit-lines="${k.id}"></div>

          <div class="kit-buy-row">
            <b>Updated total: ₹<span data-kit-edit-total="${k.id}">0</span></b>
            <button type="button" class="btn teal"
              data-kit-cart="${k.id}">
              Add Customized Kit to Cart
            </button>
          </div>
        </div>
      </article>
    `).join('')
    : '<p class="mut">No kits for this selection yet.</p>';
  applyWishlistHeartState(kitHost);

  list.forEach(k => {
    let items = (k.items || []).map(i => ({
      product_id: Number(i.product_id),
      name: i.name,
      quantity: Math.max(1, Number(i.quantity) || 1),
      price: Number(
        i.unit_price ??
        i.price ??
        (all.find(p => Number(p.id) === Number(i.product_id)) || {}).price ??
        0
      )
    }));

    const editor = kitHost.querySelector(`#kit-editor-${k.id}`);

    const total = () =>
      items.reduce((sum, item) =>
        sum + item.quantity * item.price, 0
      );

    const redraw = () => {
      const lines = kitHost.querySelector(
        `[data-kit-lines="${k.id}"]`
      );

      lines.innerHTML = items.length
        ? items.map((item, index) => `
          <div class="kit-edit-line">
            <span>${esc(item.name)}</span>

            <div class="q">
              <button type="button"
                data-kit-minus="${index}">−</button>

              <b>${item.quantity}</b>

              <button type="button"
                data-kit-plus="${index}">+</button>
            </div>
          </div>
        `).join('')
        : '<p class="mut">Your kit is empty. You cannot add it to the cart.</p>';

      kitHost.querySelector(
        `[data-kit-edit-total="${k.id}"]`
      ).textContent = total().toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    };

    kitHost.querySelector(
      `[data-customize-kit="${k.id}"]`
    ).onclick = () => {
      editor.hidden = !editor.hidden;
      redraw();
    };

    editor.addEventListener('click', e => {
      const minus = e.target.closest('[data-kit-minus]');
      const plus = e.target.closest('[data-kit-plus]');

      if (minus) {
        const index = Number(minus.dataset.kitMinus);

        if (items[index]) {
          items[index].quantity = Math.max(0, items[index].quantity - 1);
          redraw();
        }
      }

      if (plus) {
        const index = Number(plus.dataset.kitPlus);

        if (items[index]) {
          items[index].quantity = Math.min(
            99,
            items[index].quantity + 1
          );

          redraw();
        }
      }
    });

    kitHost.querySelector(
      `[data-kit-cart="${k.id}"]`
    ).onclick = () => {
      if (!items.length) {
        toast('Your kit is empty. Add at least one item.');
        return;
      }

      items.filter(item => item.quantity > 0).forEach(item => {
        const product = all.find(
          p => Number(p.id) === item.product_id
        );

        if (!product) return;

        const existing = cart.find(
          x => x.product_id === item.product_id
        );

        if (existing) {
          existing.quantity = Math.min(
            99,
            existing.quantity + item.quantity
          );
        } else {
          cart.push({
            product_id: item.product_id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            image: imageList(product)[0] || ''
          });
        }
      });

      saveCart();
      toast('Kit added to cart');
    };

    redraw();
  });
};renderKits();kitYear.onchange=renderKits;kitSubject.onchange=renderKits;kitType.onchange=renderKits;
      const newHost=$('#store-new');newHost.innerHTML=all.slice(0,4).map(card).join('')||'<p class="mut">New products will appear here.</p>';bindCards(newHost);
      const bestHost=$('#store-best');bestHost.innerHTML='<p class="mut">Loading best sellers...</p>';fetch('/api/products/best-sellers').then(r=>{if(!r.ok)throw Error('Best sellers request failed');return r.json();}).then(bd=>{bestHost.innerHTML=(bd.products||[]).length?(bd.products||[]).map(card).join(''):'<p class="mut">No completed product sales yet. Best sellers will appear here after orders are delivered.</p>';bindCards(bestHost);}).catch(()=>{bestHost.innerHTML='<p class="mut">Best sellers are temporarily unavailable.</p>';});
      refreshSubjects();render();
      let searchTimer=null;const fetchCatalogue=async()=>{const params=new URLSearchParams({q:q.value.trim(),year:y.value,subject:sub.value,group:group.value});try{const response=await fetch('/api/products?'+params.toString());if(!response.ok)throw Error('Search request failed');const result=await response.json();all=(result.products||[]).filter(p=>p.product_type==='Dental Store'||p.store_group==='OTHER_ESSENTIALS');shown=12;render();if(q.value.trim())showSuggestions();}catch(err){toast('Search could not be completed. Please try again.');}};
      const showSuggestions=()=>{const term=q.value.trim().toLowerCase();if(!term){suggestions.hidden=true;suggestions.innerHTML='';return;}const matches=all.filter(p=>[p.name,p.description,p.sku,p.search_keywords,p.subject].join(' ').toLowerCase().includes(term)||[p.name,p.description,p.sku,p.search_keywords,p.subject].join(' ').toLowerCase().includes(term.replace(/s$/,''))).slice(0,6);suggestions.innerHTML=matches.length?matches.map(p=>`<button type="button" class="store-suggestion" data-suggest="${p.id}"><b>${esc(p.name)}</b><small>₹${Number(p.price||0).toLocaleString('en-IN')} · ${esc(p.subject||'Universal')}</small></button>`).join(''):'<div class="store-suggestion-empty">No quick matches. Press Enter to search the full catalogue.</div>';suggestions.hidden=false;suggestions.querySelectorAll('[data-suggest]').forEach(b=>b.onclick=()=>{const p=all.find(x=>String(x.id)===b.dataset.suggest);q.value=p?.name||q.value;suggestions.hidden=true;render();});};
      y.onchange=()=>{refreshSubjects();shown=12;fetchCatalogue();};sub.onchange=()=>{shown=12;fetchCatalogue();};q.oninput=()=>{showSuggestions();clearTimeout(searchTimer);searchTimer=setTimeout(fetchCatalogue,250);};q.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();suggestions.hidden=true;fetchCatalogue();}};document.addEventListener('click',e=>{if(!e.target.closest('.store-search-wrap'))suggestions.hidden=true;});group.onchange=()=>{shown=12;fetchCatalogue();};if(sort)sort.onchange=()=>{shown=12;render();};$('#store-more').onclick=()=>{shown+=12;render();};
      const discoveryPanels=[...document.querySelectorAll('.store-discovery-panel')];
      // Enforce the collapsed state explicitly; this prevents broad section/layout CSS
      // from accidentally overriding the browser's [hidden] presentation.
      discoveryPanels.forEach(panel=>{panel.hidden=true;panel.style.setProperty('display','none','important');});
      const discoveryMap={kits:'#panel-kits',new:'#panel-new',best:'#panel-best'};
      document.querySelectorAll('[data-discovery]').forEach(btn=>btn.onclick=()=>{
        discoveryPanels.forEach(panel=>{panel.hidden=true;panel.style.setProperty('display','none','important');});
        const panel=$(discoveryMap[btn.dataset.discovery]);
        if(panel){panel.hidden=false;panel.style.setProperty('display','block','important');panel.scrollIntoView({behavior:'smooth',block:'start'});}
      });
      document.querySelectorAll('[data-close-discovery]').forEach(btn=>btn.onclick=()=>{
        const panel=btn.closest('.store-discovery-panel');
        if(panel){panel.hidden=true;panel.style.setProperty('display','none','important');}
      });
    }catch(e){host.textContent='Unable to load products. Please refresh.';toast(e.message||'Store unavailable.');}
    $('#rf').onsubmit=async e=>{e.preventDefault();if(role!=='user'){after='store';toast('Please sign in first.');return go('auth');}const f=e.target,file=f.img.files[0];let image='';if(file){if(file.size>1.5e6)return toast('Image must be under 1.5 MB');image=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});}try{await api('/requests',{product:f.product.value,image});toast('Product request sent.');f.reset();}catch(x){toast(x.message);}};
  },

  // CART AND CHECKOUT — catalogue product IDs only
  cart() {
    const subtotal = cart.reduce((n, x) => n + Number(x.price || 0) * Number(x.quantity || 1), 0);
    if (!cart.length) { appliedCoupon = null; A.innerHTML = `<section class="glass c"><h2>Your cart is empty</h2><button class="btn" onclick="go('store')">Browse Dental Store</button></section>`; return; }
    const discount = appliedCoupon ? Math.min(subtotal, Number(appliedCoupon.discount || 0)) : 0;
    const total = Math.max(0, subtotal - discount);
    A.innerHTML = `<div class="two"><section class="glass"><h2>Delivery details</h2><form id="of"><input name="name" placeholder="Full name" value="${esc(user?.name)}" required><input name="phone" placeholder="Phone number" value="${esc(user?.phone)}" required><input name="email" type="email" placeholder="Email" value="${esc(user?.email)}"><input name="college" placeholder="College" value="${esc(user?.college)}" required><textarea name="address" rows="3" placeholder="Full delivery address" required></textarea><h3>Payment method</h3><div class="payment-method-options"><label class="payment-method-option"><input type="radio" name="payment_method" value="COD" checked><span><b>Cash on Delivery (COD)</b><small>Pay when your order is delivered.</small></span></label><label class="payment-method-option"><input type="radio" name="payment_method" value="RAZORPAY_UPI"><span><b>UPI via Razorpay</b><small>Pay securely online using UPI.</small></span></label></div><button class="btn teal" id="pay-now" style="width:100%;margin-top:12px">Place COD order · ₹${total.toFixed(2)}</button></form></section><section class="glass"><h2>Order summary</h2>${cart.map((x,i)=>`<div class="cart-line"><div>${x.image?`<img src="${esc(x.image)}" alt="">`:''}<b>${esc(x.name)}</b><small>₹${Number(x.price).toFixed(2)} each</small></div><div class="cart-qty"><button type="button" data-dec="${i}">−</button><b>${x.quantity}</b><button type="button" data-inc="${i}">+</button><button type="button" data-remove="${i}">Remove</button></div><b>₹${(Number(x.price)*x.quantity).toFixed(2)}</b></div>`).join('')}<hr><div class="coupon-entry"><label for="checkout-coupon"><b>Have a coupon?</b></label><div class="coupon-controls"><input id="checkout-coupon" placeholder="Enter coupon code" value="${esc(appliedCoupon?.code || '')}" autocomplete="off"><button class="btn alt" type="button" id="apply-coupon">Apply</button>${appliedCoupon?'<button class="text-action" type="button" id="remove-coupon">Remove</button>':''}</div></div><hr><div class="checkout-totals"><div><span>Subtotal</span><b>₹${subtotal.toFixed(2)}</b></div>${discount?`<div class="coupon-discount"><span>Coupon (${esc(appliedCoupon.code)})</span><b>− ₹${discount.toFixed(2)}</b></div>`:''}<div class="checkout-grand-total"><span>Total payable</span><strong>₹${total.toFixed(2)}</strong></div></div><p class="mut">Delivery charges, if applicable, will be confirmed separately.</p></section></div>`;
    const refreshCart = () => {
      const scrollPosition = window.scrollY;
      const form = $('#of');
      const formValues = form ? Object.fromEntries(new FormData(form).entries()) : {};
      views.cart();
      const newForm = $('#of');
      if (newForm) Object.entries(formValues).forEach(([name, value]) => { const field = newForm.elements.namedItem(name); if (field) field.value = value; });
      saveCart(); requestAnimationFrame(() => window.scrollTo(0, scrollPosition));
    };
    A.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => { const i=Number(b.dataset.inc); cart[i].quantity=Math.min(99,cart[i].quantity+1); appliedCoupon=null; refreshCart(); });
    A.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => { const i=Number(b.dataset.dec); cart[i].quantity=Math.max(0,Number(cart[i].quantity||0)-1); appliedCoupon=null; refreshCart(); });
    A.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { cart.splice(Number(b.dataset.remove),1); appliedCoupon=null; refreshCart(); });
    $('#apply-coupon').onclick = async () => {
      if (role !== 'user') { after='cart'; toast('Please sign in to apply a coupon.'); return go('auth'); }
      const code=$('#checkout-coupon').value.trim(); if(!code){$('#coupon-message').textContent='Enter your coupon code.';return;}
      const button=$('#apply-coupon'); button.disabled=true; button.textContent='Checking…';
      try { const quote=await api('/coupon/validate',{code,items:cart.filter(x=>x.quantity>0).map(x=>({product_id:x.product_id,quantity:x.quantity}))}); appliedCoupon={code:quote.code,discount:Number(quote.discount)}; toast('Coupon applied. ₹100 discount added.'); views.cart(); }
      catch(error){ appliedCoupon=null; $('#coupon-message').textContent=error.message; $('#coupon-message').classList.add('coupon-error'); button.disabled=false; button.textContent='Apply'; }
    };
    $('#remove-coupon')?.addEventListener('click',()=>{appliedCoupon=null;views.cart();});
    const payButton=$('#pay-now');
    A.querySelectorAll('input[name="payment_method"]').forEach(input=>input.addEventListener('change',()=>{
      payButton.textContent=input.value==='COD'?`Place COD order · ₹${total.toFixed(2)}`:`Pay ₹${total.toFixed(2)} via UPI`;
    }));
    $('#of').onsubmit=async e=>{
      e.preventDefault();
      if(role!=='user'){after='cart';toast('Please sign in to continue checkout');return go('auth');}
      const button=$('#pay-now'); button.disabled=true;
      try {
        const data=Object.fromEntries(new FormData(e.target));
        const activeItems=cart.filter(x=>Number(x.quantity)>0);
        if(!activeItems.length) throw new Error('Your cart is empty.');
        const payload={...data,coupon_code:appliedCoupon?.code||'',items:activeItems.map(x=>({product_id:x.product_id,quantity:x.quantity}))};
        if(data.payment_method==='COD'){
          button.textContent='Placing your COD order…';
          const order=await api('/orders',payload);
          finishBuyNowOrder();done(order);return;
        }
        button.textContent='Starting secure checkout…';
        const created=await api('/payments/razorpay/create',payload);
        if(created.free){finishBuyNowOrder();done(created.order);return;}
        if(!window.Razorpay){await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://checkout.razorpay.com/v1/checkout.js';script.onload=resolve;script.onerror=()=>reject(new Error('Unable to load Razorpay Checkout. Check your internet connection.'));document.head.appendChild(script);});}
        const checkout=new window.Razorpay({key:created.keyId,amount:created.amount,currency:created.currency,name:'CUSPYLO',description:`Order ${created.invoice}`,order_id:created.razorpayOrderId,method:'upi',prefill:{name:data.name,email:data.email,contact:data.phone},notes:{invoice:created.invoice},theme:{color:'#12b8c7'},modal:{ondismiss:()=>{button.disabled=false;button.textContent=`Pay ₹${total.toFixed(2)} via UPI`;toast('Payment was not completed. Your cart is still saved.');}},handler:async response=>{try{const verified=await api('/payments/razorpay/verify',response);finishBuyNowOrder();done(verified.order);}catch(error){button.disabled=false;button.textContent='Verify payment / retry';toast(error.message||'Payment verification is pending. Contact support with your Razorpay payment ID.');}}});
        checkout.on('payment.failed',failure=>{button.disabled=false;button.textContent=`Pay ₹${total.toFixed(2)} via UPI`;toast(failure.error?.description||'Payment failed. Your cart is still saved.');});
        checkout.open();
      } catch(error) { button.disabled=false; const method=$('input[name="payment_method"]:checked')?.value; button.textContent=method==='COD'?`Place COD order · ₹${total.toFixed(2)}`:`Pay ₹${total.toFixed(2)} via UPI`; toast(error.message); }
    };
  },

  // STUDENT ACCOUNT AND ORDER HISTORY
  async account() {
    if (role !== 'user') { after = 'account'; return go('auth'); }
    let orders = [];
    try { orders = (await api('/my/orders')).orders || []; }
    catch (e) { toast(e.message); }

    window.__cuspyloOrders = orders;
    const steps = [
      { key: 'RECEIVED', label: 'Order Received', hint: 'Your order has been confirmed' },
      { key: 'PACKED', label: 'Packed', hint: 'Your items are being prepared' },
      { key: 'OUT_FOR_DELIVERY', label: 'Out for Delivery', hint: 'Your order is on its way' },
      { key: 'DELIVERED', label: 'Delivered', hint: 'Your order has been delivered' }
    ];
    const statusKey = value => ({
      'Received':'RECEIVED','RECEIVED':'RECEIVED','Packed':'PACKED','PACKED':'PACKED',
      'Out for Delivery':'OUT_FOR_DELIVERY','OUT_FOR_DELIVERY':'OUT_FOR_DELIVERY',
      'Delivered':'DELIVERED','Completed':'DELIVERED','DELIVERED':'DELIVERED'
    }[String(value || '').toUpperCase()] || ({'Received':'RECEIVED','Packed':'PACKED','Out for Delivery':'OUT_FOR_DELIVERY','Delivered':'DELIVERED','Completed':'DELIVERED'}[value] || 'RECEIVED'));
    const itemSummary = o => (o.lineItems || []).map(item => {
      const name = item.item_name || (item.fdi_number ? `Tooth ${item.fdi_number}` : 'Item');
      return `${name} × ${item.quantity || 1}`;
    }).join(', ') || (o.items || []).map(i => `${i.name||'Product'} × ${i.quantity||1}`).join(', ');

    A.innerHTML = `
      <section class="glass account-page">
  <div class="account-profile-details">
    <p><b>Name:</b> ${esc(user?.name || '')}</p>
    <p><b>College:</b> ${esc(user?.college || '')}</p>
    <p><b>Year:</b> ${esc(user?.academic_year || user?.year || 'Not specified')}</p>
    <p><b>Phone:</b> ${esc(user?.phone || '')}</p>
    <p><b>Email:</b> ${esc(user?.email || '')}</p>
  </div>
        <div class="account-section-heading"><h3>Your orders</h3><span>${orders.length} order${orders.length===1?'':'s'}</span></div>
        ${orders.length ? orders.map(o => {
          const current = statusKey(o.status);
          const currentIndex = Math.max(0, steps.findIndex(step => step.key === current));
          const history = Array.isArray(o.tracking) ? o.tracking : [];
          const trackingRows = steps.map((step, index) => {
            const record = history.find(h => statusKey(h.status || h.new_status) === step.key);
            const complete = index <= currentIndex;
            const stamp = record?.at || record?.created_at;
            return `<div class="track-step ${complete?'is-complete':''} ${index===currentIndex?'is-current':''}">
              <span class="track-marker">${complete?'✓':index+1}</span>
              <div class="track-copy"><b>${step.label}</b><small>${stamp ? new Date(stamp).toLocaleString('en-IN') : (complete ? step.hint : 'Awaiting update')}</small></div>
            </div>`;
          }).join('');
          return `<article class="student-order-card">
            <div class="student-order-top"><div><span class="order-eyebrow">ORDER INVOICE</span><b class="order-invoice-number">${esc(o.invoice)}</b></div><span class="order-status-pill">${esc(o.status)}</span></div>
            <p class="student-order-items">${esc(itemSummary(o))}</p>
            <div class="student-order-meta"><b>₹${Number(o.total || 0).toFixed(2)}</b><span>${new Date(o.date).toLocaleString('en-IN')}</span></div>
            <div class="student-order-actions">
              <button class="text-action" type="button" onclick="showStudentOrderDetails('${esc(o.invoice)}')">View order details →</button>
            </div>
            <div class="student-tracking-panel" id="track-${esc(o.invoice)}" hidden><h4>Order journey</h4><div class="tracking-timeline">${trackingRows}</div></div>
          </article>`;
        }).join('') : '<p class="mut">No orders yet.</p>'}
        <button class="btn" onclick="go('store')">Shop products</button>
      </section>`;
  },


  async quiz() {
    if (role !== 'user') { after = 'quiz'; return go('auth'); }

    A.innerHTML = `
      <section class="sec glass academic-resource-page quiz-page">
        <button class="text-action" type="button" onclick="go('dash')">← Dashboard</button>
        <span class="poster-tag">CUSPYLO ACADEMICS</span>
        <h1>Quiz</h1>
        <p>Choose your academic year and optionally a subject to practise.</p>
        <div class="academic-resource-filters">
          <label>Academic year <select id="quiz-year">
            <option value="">Select year</option>
            <option>1st Year</option><option>2nd Year</option>
            <option>3rd Year</option><option>4th Year</option>
          </select></label>
          <label>Subject (optional) <select id="quiz-subject" disabled>
            <option value="">All subjects</option>
          </select></label>
        </div>
        <div id="quiz-content" class="quiz-content">
          <p class="mut">Select an academic year to load published questions.</p>
        </div>
      </section>`;

    const year = $('#quiz-year');
    const subject = $('#quiz-subject');
    const host = $('#quiz-content');
    const subjectMap = ACADEMIC_SUBJECTS;
    let questions = [];
    let index = 0;
    let score = 0;
    let locked = false;

    const loadQuestions = async () => {
      if (!year.value) {
        subject.disabled = true;
        subject.innerHTML = '<option value="">All subjects</option>';
        host.innerHTML = '<p class="mut">Select an academic year to load published questions.</p>';
        return;
      }
      const available = subjectMap[year.value] || [];
      const previous = subject.value;
      subject.innerHTML = '<option value="">All subjects</option>' +
        available.map(x => `<option>${esc(x)}</option>`).join('');
      if (available.includes(previous)) subject.value = previous;
      subject.disabled = false;
      host.innerHTML = '<p class="mut">Loading quiz questions…</p>';
      try {
        const params = new URLSearchParams({year: year.value, subject: subject.value});
        const data = await api('/quizzes?' + params.toString());
        questions = data.questions || [];
        index = 0;
        score = 0;
        locked = false;
        renderQuestion();
      } catch (error) {
        host.innerHTML = `<p class="mut">${esc(error.message || 'Unable to load quiz questions.')}</p>`;
      }
    };

    const renderQuestion = () => {
      if (!questions.length) {
        host.innerHTML = '<div class="academic-resource-empty"><h3>No published questions found</h3><p>Try another subject or ask your admin to publish questions for this year.</p></div>';
        return;
      }
      if (index >= questions.length) {
        host.innerHTML = `<div class="quiz-result"><span class="poster-tag">QUIZ COMPLETED</span><h2>Your score: ${score} / ${questions.length}</h2><p>${Math.round(score / questions.length * 100)}% correct</p><button class="btn teal" id="quiz-restart" type="button">Try again</button></div>`;
        $('#quiz-restart').onclick = () => { index = 0; score = 0; renderQuestion(); };
        return;
      }
      const q = questions[index];
      const opts = [['A',q.option_a],['B',q.option_b],['C',q.option_c],['D',q.option_d]];
      host.innerHTML = `<article class="quiz-question-card">
        <div class="quiz-question-meta"><span>${esc(q.academic_year)}</span><span>${esc(q.subject)}</span><span>Question ${index+1} of ${questions.length}</span></div>
        <h2>${esc(q.question)}</h2>
        <div class="quiz-options">${opts.map(([key,label]) => `<label class="quiz-option"><input type="radio" name="quiz-answer" value="${key}"><span><b>${key}.</b> ${esc(label)}</span></label>`).join('')}</div>
        <div id="quiz-feedback" class="quiz-feedback" aria-live="polite"></div>
        <div class="quiz-actions"><button class="btn teal" id="quiz-submit" type="button">Submit answer</button><button class="btn alt" id="quiz-next" type="button" hidden>${index+1===questions.length?'See results':'Next question'}</button></div>
      </article>`;
      $('#quiz-submit').onclick = async () => {
        if (locked) return;
        const selected = host.querySelector('input[name="quiz-answer"]:checked')?.value;
        if (!selected) { toast('Choose an option before submitting.'); return; }
        const submit = $('#quiz-submit');
        submit.disabled = true;
        try {
          const result = await api(`/quizzes/${encodeURIComponent(q.id)}/answer`, {selected_option:selected});
          locked = true;
          if (result.correct) score++;
          const feedback = $('#quiz-feedback');
          feedback.className = `quiz-feedback ${result.correct?'is-correct':'is-wrong'}`;
          feedback.innerHTML = `<strong>${result.correct?'Correct answer!':'Not quite — the correct answer is '+esc(result.correct_option)+'.'}</strong>
            <p>${esc(result.correct_answer || '')}</p>
            ${result.explanation ? `<p>${esc(result.explanation)}</p>` : ''}`;
          host.querySelectorAll('input[name="quiz-answer"]').forEach(input => input.disabled = true);
          submit.hidden = true;
          $('#quiz-next').hidden = false;
        } catch (error) {
          submit.disabled = false;
          toast(error.message || 'Unable to submit your answer.');
        }
      };
      $('#quiz-next').onclick = () => { index++; locked = false; renderQuestion(); };
    };

    year.onchange = loadQuestions;
    subject.onchange = loadQuestions;
  },

  async studyPartner() {
    if (role !== 'user') { after = 'studyPartner'; return go('auth'); }
    A.innerHTML = `
      <section class="sec glass academic-resource-page study-partner-page">
        <button class="text-action" type="button" onclick="go('dash')">← Dashboard</button>
        <span class="poster-tag">CUSPYLO ACADEMICS</span>
        <h1>Study Partner</h1>
        <p>Find your dental products and academic resources together in one place.</p>
        <div class="academic-resource-filters study-partner-filters">
          <label>Academic year <select id="study-year"><option value="">All years</option><option>1st Year</option><option>2nd Year</option><option>3rd Year</option><option>4th Year</option><option>Internship</option></select></label>
          <label>Subject (optional) <select id="study-subject"><option value="">All subjects</option></select></label>
          <label>Resource type <select id="study-type"><option value="all">All resources</option><option value="store">Dental Store</option><option value="Notes">Notes</option><option value="PYQs">PYQs</option><option value="Mind Maps">Mind Maps</option><option value="pdfs">All PDFs</option></select></label>
        </div>
        <div id="study-partner-content"><p class="mut">Loading your study resources…</p></div>
      </section>
      <div id="study-pdf-modal" class="resource-pdf-modal" hidden><div class="resource-pdf-dialog" role="dialog" aria-modal="true" aria-label="PDF preview"><div class="resource-pdf-heading"><strong id="study-pdf-title">Resource preview</strong><button type="button" class="btn alt" id="study-pdf-close">Close ×</button></div><p class="mut">Preview limited to the first 2 pages.</p><iframe id="study-pdf-frame" title="PDF preview"></iframe></div></div>`;

    const host = $('#study-partner-content');
    const year = $('#study-year');
    const subject = $('#study-subject');
    const type = $('#study-type');
    let products = [];
    let pdfUrl = '';
    const subjectsByYear = ACADEMIC_SUBJECTS;
    const groups = [
      { key: 'store', title: 'Dental Store' },
      { key: 'Notes', title: 'Notes' },
      { key: 'PYQs', title: 'Previous Year Questions' },
      { key: 'Mind Maps', title: 'Mind Maps' }
    ];
    const isAcademic = p => ['Notes', 'PYQs', 'Mind Maps'].includes(String(p.product_type || ''));
    const isPhysical = p => String(p.product_type || '') === 'Dental Store' && !isAcademic(p);
    const openPdf = async (p, mode) => {
      try {
        const r = await fetch(`/api/resources/${p.id}/pdf?mode=${mode}`, { headers: { Authorization: 'Bearer ' + token } });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw Error(d.error || 'Unable to open this PDF.'); }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        if (mode === 'download') {
          const a = document.createElement('a'); a.href = url; a.download = p.pdf_filename || `${p.name}.pdf`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
        } else {
          if (pdfUrl) URL.revokeObjectURL(pdfUrl); pdfUrl = url;
          $('#study-pdf-title').textContent = p.name; $('#study-pdf-frame').src = url; $('#study-pdf-modal').hidden = false;
        }
      } catch (e) { toast(e.message); }
    };
    const closePdf = () => { $('#study-pdf-modal').hidden = true; $('#study-pdf-frame').src = 'about:blank'; if (pdfUrl) URL.revokeObjectURL(pdfUrl); pdfUrl = ''; };
    $('#study-pdf-close').onclick = closePdf;
    $('#study-pdf-modal').addEventListener('click', e => { if (e.target.id === 'study-pdf-modal') closePdf(); });
    const render = () => {
      const filtered = products.filter(p =>
        (!year.value || p.academic_year === 'Universal' || p.academic_year === year.value) &&
        (!subject.value || p.subject === 'Universal' || p.subject === subject.value)
      );
      const selected = type.value;
      const visibleGroups = groups.filter(g => selected === 'all' || selected === 'pdfs' ? (selected === 'all' || g.key !== 'store') : selected === g.key);
      host.innerHTML = visibleGroups.map(g => {
        const list = filtered.filter(p => g.key === 'store' ? isPhysical(p) : p.product_type === g.key);
        const cards = list.map(p => {
          if (g.key === 'store') {
            return `<article class="academic-resource-card study-partner-card"><button class="wishlist-heart" type="button" data-wishlist-product="${p.id}" aria-label="Add to wishlist" title="Add to wishlist">♡</button><div class="academic-resource-card-top">${p.image_data ? `<img class="academic-resource-cover" src="${esc(p.image_data)}" alt="${esc(p.name)}">` : '<div class="academic-resource-cover-placeholder"><span>PRODUCT</span><i>▤</i></div>'}<span class="academic-resource-type">DENTAL PRODUCT</span></div><div class="academic-resource-card-body"><div class="academic-resource-meta"><span>${esc(p.academic_year || 'Universal')}</span><span>${esc(p.subject || 'Universal')}</span></div><h3>${esc(p.name)}</h3>${p.description ? `<p class="academic-resource-description">${esc(p.description)}</p>` : ''}<div class="academic-resource-card-footer"><div class="academic-resource-price-block"><small>PRICE</small><strong>₹${Number(p.price || 0).toLocaleString('en-IN')}</strong></div><span class="academic-resource-file-state is-ready">${Number(p.stock_quantity) > 0 ? `${p.stock_quantity} in stock` : 'Available to order'}</span></div><div class="academic-resource-actions"><button class="btn teal" type="button" data-study-store="${p.id}">Add to cart</button></div></div></article>`;
          }
          const free = Number(p.price) === 0;
          return `<article class="academic-resource-card study-partner-card"><button class="wishlist-heart" type="button" data-wishlist-product="${p.id}" aria-label="Add to wishlist" title="Add to wishlist">♡</button><div class="academic-resource-card-top">${p.image_data ? `<img class="academic-resource-cover" src="${esc(p.image_data)}" alt="${esc(p.name)}">` : '<div class="academic-resource-cover-placeholder"><span>PDF</span><i>▤</i></div>'}<span class="academic-resource-type">${free ? 'FREE RESOURCE' : 'PAID RESOURCE'}</span></div><div class="academic-resource-card-body"><div class="academic-resource-meta"><span>${esc(p.academic_year || 'Universal')}</span><span>${esc(p.subject || 'Universal')}</span></div><h3>${esc(p.name)}</h3>${p.description ? `<p class="academic-resource-description">${esc(p.description)}</p>` : ''}<div class="academic-resource-card-footer"><div class="academic-resource-price-block"><small>PRICE</small><strong>${free ? 'FREE' : `₹${Number(p.price).toLocaleString('en-IN')}`}</strong></div><span class="academic-resource-file-state ${p.has_pdf ? 'is-ready' : 'is-pending'}">${p.has_pdf ? 'PDF available' : 'PDF coming soon'}</span></div><div class="academic-resource-actions">${!p.has_pdf ? '<span class="academic-resource-unavailable">This resource is not available yet</span>' : free ? `<button class="btn teal" type="button" data-study-download="${p.id}">Download PDF</button>` : `<button class="btn alt" type="button" data-study-preview="${p.id}">Preview 2 pages</button><button class="btn teal" type="button" data-study-cart="${p.id}">Add to cart</button>`}</div></div></article>`;
        }).join('');
        return `<section class="study-partner-group"><div class="study-partner-heading"><h2>${g.title}</h2><span>${list.length} item${list.length === 1 ? '' : 's'}</span></div>${cards ? `<div class="academic-resource-grid">${cards}</div>` : '<p class="study-partner-empty mut">No resources found for these filters.</p>'}</section>`;
      }).join('');
      applyWishlistHeartState(host);
      host.querySelectorAll('[data-study-store]').forEach(b => b.onclick = () => { const p = products.find(x => String(x.id) === b.dataset.studyStore); if (p) addProductToCart(p); });
      host.querySelectorAll('[data-study-preview]').forEach(b => b.onclick = () => { const p = products.find(x => String(x.id) === b.dataset.studyPreview); if (p) openPdf(p, 'preview'); });
      host.querySelectorAll('[data-study-download]').forEach(b => b.onclick = () => { const p = products.find(x => String(x.id) === b.dataset.studyDownload); if (p) openPdf(p, 'download'); });
      host.querySelectorAll('[data-study-cart]').forEach(b => b.onclick = () => { const p = products.find(x => String(x.id) === b.dataset.studyCart); if (!p) return; const old = cart.find(x => Number(x.product_id) === Number(p.id)); if (old) old.quantity = Math.min(99, Number(old.quantity || 0) + 1); else cart.push({ product_id: Number(p.id), name: p.name, price: Number(p.price), quantity: 1, image: p.image_data || '' }); saveCart(); toast(`${p.product_type} added to cart`); });
    };
    const load = async () => {
      const available = subjectsByYear[year.value] || [];
      const previous = subject.value;
      subject.innerHTML = '<option value="">All subjects</option>' + available.map(s => `<option>${esc(s)}</option>`).join('');
      if (available.includes(previous)) subject.value = previous;
      subject.disabled = !year.value;
      host.innerHTML = '<p class="mut">Loading your study resources…</p>';
      try { const r = await fetch('/api/products', { cache: 'no-store' }); if (!r.ok) throw Error('Unable to load study resources.'); const d = await r.json(); products = (d.products || []).filter(p => p.active !== false && (isPhysical(p) || isAcademic(p))); render(); }
      catch (e) { host.innerHTML = `<p class="mut">${esc(e.message)}</p>`; }
    };
    year.onchange = () => { subject.value = ''; load(); };
    subject.onchange = render;
    type.onchange = render;
    await load();
  },
  notes() { return showAcademicResources('Notes', 'Notes', 'Your study material, organised by year and subject.'); },
  pyqs() { return showAcademicResources('PYQs', 'Previous Year Questions', 'Practice smarter with question papers organised by year and subject.'); },
  mindmaps() { return showAcademicResources('Mind Maps', 'Mind Maps', 'Visual summaries to help you revise faster and remember more.'); },

  async sell() {
    if(role!=='user') return go('auth');
    A.innerHTML=`<section class="sell-page"><button class="btn ghost" onclick="go('dash')">← Dashboard</button>
      <header class="sell-hero"><span class="eyebrow">CUSPYLO COMMUNITY MARKETPLACE</span><h1>Sell on Cuspylo</h1><p>List your pre-owned dental products for other students.</p></header>
      <div class="sell-commission"><h3>Transparent seller commission</h3><p>Cuspylo retains 20% of the product price only after a sale is successfully completed. You receive 80%. Delivery charges are paid separately by the buyer.</p><div class="sell-math"><span>Example selling price <b>₹1,000</b></span><span>Cuspylo commission <b>₹200</b></span><span>Your share <b>₹800</b></span></div></div>
      <form id="sell-listing-form" class="sell-form"><h2>List my product</h2>
        <label>Product name<input name="product_name" maxlength="160" required></label><label>Description<textarea name="description" rows="4" maxlength="3000" required></textarea></label>
        <div class="sell-fields"><label>Years used<input name="years_used" type="number" min="0" max="99" step="0.5" required></label>
        <label>Academic year<select name="academic_year" required><option value="">Select year</option>${['1st Year','2nd Year','3rd Year','4th Year','Internship'].map(x=>`<option>${x}</option>`).join('')}</select></label>
        <label>Subject<input name="subject" maxlength="100" required></label><label>Selling price (₹)<input name="asking_price" type="number" min="1" step=".01" required></label></div>
        <label>Product image (optional)<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <p class="mut">Your listing will be reviewed by Cuspylo before it appears in the Dental Store. Multiple listings are allowed.</p><button class="btn teal" type="submit">Review My Product</button></form>
      <section class="sell-my-listings"><h2>My submitted listings</h2><div id="my-sell-listings">Loading…</div></section></section>`;
    const form=$('#sell-listing-form');
    const loadMine=async()=>{try{const d=await api('/sell-on-cuspylo/mine');$('#my-sell-listings').innerHTML=(d.listings||[]).map(x=>`<article class="sell-listing-row"><div><b>${esc(x.product_name)}</b><small>${esc(x.academic_year)} · ${esc(x.subject)} · ₹${Number(x.asking_price).toFixed(2)}</small></div><span class="sell-status ${esc(x.status.toLowerCase())}">${esc(x.status)}</span>${x.admin_note?`<p>${esc(x.admin_note)}</p>`:''}</article>`).join('')||'<p class="mut">You have not submitted any products yet.</p>';}catch(e){$('#my-sell-listings').textContent=e.message;}};
    await loadMine();
    form.onsubmit=async e=>{e.preventDefault();const btn=form.querySelector('button[type=submit]');btn.disabled=true;try{const data=Object.fromEntries(new FormData(form));const file=form.elements.image.files[0];if(file){if(file.size>1_800_000)throw Error('Choose an image smaller than 1.8 MB.');data.image_data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('Unable to read image.'));r.readAsDataURL(file);});}delete data.image;data.years_used=Number(data.years_used);data.asking_price=Number(data.asking_price);await api('/sell-on-cuspylo',data);toast('Submitted for admin review.');form.reset();await loadMine();}catch(err){toast(err.message);}finally{btn.disabled=false;}};
  },

  async wishlist() {
    if (role !== 'user') { after = 'wishlist'; return go('auth'); }
    A.innerHTML = `<section class="sec glass wishlist-page">
      <button class="text-action" type="button" onclick="go('dash')">← Dashboard</button>
      <span class="poster-tag">YOUR SAVED ITEMS</span>
      <h1>My Wishlist</h1>
      <p class="mut">Products and kits saved to your account.</p>
      <div id="wishlist-list"><p class="mut">Loading your wishlist…</p></div>
    </section>`;
    const host = $('#wishlist-list');
    const render = async () => {
      try {
        const data = await api('/wishlist');
        const items = data.items || [];
        if (!items.length) {
          host.innerHTML = `<div class="wishlist-empty"><div>♡</div><h3>Your wishlist is empty</h3><p class="mut">Save products and kits using the heart icon.</p><button class="btn teal" type="button" onclick="go('store')">Explore Dental Store</button></div>`;
          return;
        }
        host.innerHTML = `<div class="wishlist-grid">${items.map(item => {
          const isKit = item.item_type === 'kit';
          const free = !isKit && Number(item.price) === 0 && ['Notes','PYQs','Mind Maps'].includes(item.product_type);
          const image = item.image_data ? `<img src="${esc(item.image_data)}" alt="${esc(item.name)}">` : `<div class="wishlist-placeholder">${isKit?'KIT':'PDF / PRODUCT'}</div>`;
          return `<article class="wishlist-card"><button class="wishlist-heart is-saved" type="button" data-wishlist-${isKit?'kit':'product'}="${isKit?item.kit_id:item.product_id}" aria-pressed="true" aria-label="Remove from wishlist" title="Remove from wishlist">♥</button>${image}<div class="wishlist-card-body"><small>${esc(item.academic_year||'Universal')} · ${esc(item.subject||'Universal')}</small><h3>${esc(item.name)}</h3><p class="mut">${esc(item.product_type||'Product')}</p><strong class="wishlist-price">${free?'FREE':`₹${Number(item.price||0).toLocaleString('en-IN')}`}</strong><div class="wishlist-actions">${free?`<button class="btn teal" type="button" data-wishlist-download="${item.product_id}">Download PDF</button>`:!isKit?`<button class="btn teal" type="button" data-wishlist-cart="${item.product_id}">Add to Cart</button>`:`<span class="mut">Kit saved</span>`}</div></div></article>`;
        }).join('')}</div>`;
        applyWishlistHeartState(host);
        host.querySelectorAll('[data-wishlist-cart]').forEach(btn => btn.onclick = () => {
          const item = items.find(x => String(x.product_id)===btn.dataset.wishlistCart);
          if (!item) return;
          const old = cart.find(x => Number(x.product_id)===Number(item.product_id));
          if (old) old.quantity=Math.min(99,old.quantity+1);
          else cart.push({product_id:Number(item.product_id),name:item.name,price:Number(item.price||0),quantity:1,image:item.image_data||''});
          saveCart(); toast('Added to cart.');
        });
        host.querySelectorAll('[data-wishlist-download]').forEach(btn => btn.onclick = () => {
          const item=items.find(x=>String(x.product_id)===btn.dataset.wishlistDownload);
          if(item) window.open(`/api/resources/${item.product_id}/pdf?mode=download`, '_blank');
        });
      } catch(e) { host.innerHTML=`<p class="mut">${esc(e.message)}</p>`; }
    };
    await render();
  },

  about() {
    A.innerHTML = `<section class="glass info-page"><h2>About CUSPYLO</h2><p>CUSPYLO is building a convenient place for dental students to discover practical supplies and learning resources. Our goal is to make essential student needs easier to find, compare and access.</p><p>We are continuously improving the platform with feedback from the dental student community.</p><button class="btn" onclick="go('store')">Explore Dental Store</button></section>`;
  },
  contact() {
    const number = String(cfg.whatsapp || '').replace(/\D/g, '');
    const wa = number.length >= 10 ? `https://wa.me/${number}?text=Hi%20CUSPYLO` : '#contact';
    A.innerHTML = `<section class="glass info-page"><h2>Contact Us</h2><p>Need help with an order or have a question? Reach out to the CUSPYLO team.</p><div class="contact-actions"><a class="btn wa" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>${cfg.email ? `<a class="btn alt" href="mailto:${esc(cfg.email)}">Email CUSPYLO</a>` : ''}${cfg.instagram ? `<a class="btn alt" href="${esc(cfg.instagram)}" target="_blank" rel="noopener">Instagram · @cuspylo</a>` : ''}</div><p class="mut">${esc(cfg.email || 'Contact details will be updated here.')}</p></section>`;
  },
  async faqs() {
    A.innerHTML = `<section class="glass info-page"><h2>FAQs</h2><p>Answers to common questions about CUSPYLO.</p><div id="public-faq-list">Loading FAQs…</div><p class="mut">Need more help? Visit Contact Us or message our team.</p></section>`;
    try {
      const r=await fetch('/api/faqs',{cache:'no-store'}); const d=await r.json();
      if(!r.ok)throw Error(d.error||'Unable to load FAQs.');
      const target=$('#public-faq-list');
      const faqs=Array.isArray(d.faqs)?d.faqs:[];
      target.innerHTML=faqs.length?faqs.map(f=>`<details class="public-faq"><summary>${esc(f.question)}</summary><p>${esc(f.answer).replace(/\n/g,'<br>')}</p></details>`).join(''):'<p class="mut">No FAQs have been published yet. Please contact our team if you need help.</p>';
    } catch(e) { const target=$('#public-faq-list'); if(target)target.textContent='FAQs are temporarily unavailable. Please try again later.'; }
  },
  async joinus() {
    const number=String(cfg.whatsapp||'').replace(/\D/g,'');
    const other=number.length>=10?`https://wa.me/${number}?text=Hi%20CUSPYLO%2C%20I%20have%20another%20inquiry%20about%20joining.`:'#contact';
    A.innerHTML=`<section class="glass info-page"><h2>Join Us</h2><p>We're building something meaningful for the dental student community. If you'd like to contribute your skills, ideas and energy, we'd love to hear from you.</p><div id="public-opportunities">Loading opportunities…</div><hr><h3>Interested in joining CUSPYLO?</h3><p>Tell us a little about yourself, the opportunity you're interested in, and how you'd like to contribute. Our team will get back to you.</p><a class="btn wa" href="${other}" target="_blank" rel="noopener">Apply / Enquire on WhatsApp</a></section>`;
    try {
      const r=await fetch('/api/opportunities'); const d=await r.json();
      if(!r.ok)throw Error(d.error||'Unable to load opportunities.');
      const target=$('#public-opportunities');
      target.innerHTML=d.opportunities.length?d.opportunities.map(o=>`<article class="public-opportunity"><h3>${esc(o.title)}</h3><p>${esc(o.description).replace(/\n/g,'<br>')}</p>${o.requirements?`<p><strong>Requirements:</strong> ${esc(o.requirements).replace(/\n/g,'<br>')}</p>`:''}<p class="mut">${esc(o.location)} · ${esc(o.work_type)}</p>${o.application_url?`<a class="text-action" href="${esc(o.application_url)}" target="_blank" rel="noopener">View application details →</a>`:''}</article>`).join(''):'<p class="mut">There are no open opportunities at the moment. Check back later.</p>';
    } catch(e) { const target=$('#public-opportunities'); if(target)target.textContent='Opportunities are temporarily unavailable. Please try again later.'; }
  },


  // ADMIN PORTAL

  async admin() {

    if (role !== 'admin') {

      
A.innerHTML = `

  <div class="admin-header">
    <div>
      <h2>Admin portal</h2>
      <p class="mut">
        Manage orders, invoices, requests and feedback.
      </p>
    </div>

  </div>

  <br>


          <form id="ad">

            <input name="id" placeholder="Admin ID" required>

            <input name="password" type="password"
              placeholder="Password" required>

            <button class="btn" style="width:100%">
              Sign in
            </button>

          </form>

        </section>
      `;

      $('#ad').onsubmit = async e => {
        e.preventDefault();

        try {
          setAuth(
            await api('/admin/login', Object.fromEntries(new FormData(e.target))),
            'admin'
          );

          go('admin');

        } catch (x) {
          toast(x.message);
        }
      };

      return;
    }


    let d;

    try {
      d = await api('/admin/data');
    } catch (e) {
      toast(e.message);
      return logout();
    }

    window.AD = d;

    const date = x => new Date(x).toLocaleString('en-IN');


    const tabs = {

      Orders: `
        <div class="sc">

          <table>

            <tr>
              <th>Invoice</th>
              <th>Customer</th>
              <th>Products</th>
              <th>Total</th>
              <th>Date</th>
              <th></th>
            </tr>

            ${d.orders.map((o, i) => `
              <tr>

                <td>${esc(o.invoice)}</td>

                <td>
                  ${esc(o.name)}<br>
                  ${esc(o.phone)}<br>
                  ${esc(o.college)}<br>
                  <small>${esc(o.address)}</small>
                </td>

                <td>${(o.lineItems||[]).map(x=>`${esc(x.item_name)} × ${x.quantity}`).join(', ')}</td>

                <td>
                  ₹${o.total}<br>
                  <small>${o.payment}</small>
                </td>

                <td>${date(o.date)}</td>

                <td>
                  <button class="btn sm" onclick="inv(${i})">
                    Invoice
                  </button>
                </td>

              </tr>
            `).join('') || '<tr><td colspan="6">No orders yet</td></tr>'}

          </table>

        </div>
      `,


      Requests: `
        <div class="sc">

          <table>

            <tr>
              <th>Product</th>
              <th>Image</th>
              <th>User</th>
              <th>Phone</th>
              <th>Date</th>
            </tr>

            ${d.requests.map(r => `
              <tr>

                <td>${esc(r.product)}</td>

                <td>
                  ${r.image
                    ? `<img src="${esc(r.image)}" width="70" alt="request image">`
                    : '—'
                  }
                </td>

                <td>${esc(r.username)}</td>

                <td>${esc(r.phone)}</td>

                <td>${date(r.date)}</td>

              </tr>
            `).join('') || '<tr><td colspan="5">No requests yet</td></tr>'}

          </table>

        </div>
      `,


      Feedback: `
        <div class="sc">

          <table>

            <tr>
              <th>From</th>
              <th>Message</th>
              <th>Date</th>
            </tr>

            ${d.feedback.map(f => `
              <tr>

                <td>
                  ${esc(f.name)}<br>
                  <small>${esc(f.contact)}</small>
                </td>

                <td>${esc(f.message)}</td>

                <td>${date(f.date)}</td>

              </tr>
            `).join('') || '<tr><td colspan="3">No feedback yet</td></tr>'}

          </table>

        </div>
      `
    };


    A.innerHTML = `

      <div class="admin-header"><div><h2>Admin portal</h2>
      <p class="mut">Orders, invoices, product requests and feedback.</p></div>
      <button class="btn admin-control-btn" onclick="window.location.href='/admin-console.html'"><span>⚙</span> Admin Control Centre</button></div>

      <br>

      <div class="tabs">

        ${Object.keys(tabs).map((k, i) => `
          <button class="btn ${i ? '' : 'on'}" data-k="${k}">
            ${k} (${d[k.toLowerCase()].length})
          </button>
        `).join('')}

      </div>

      <div id="tb">
        ${tabs.Orders}
      </div>
    `;


    A.querySelectorAll('.tabs .btn').forEach(b => {

      b.onclick = () => {

        A.querySelectorAll('.tabs .btn').forEach(x =>
          x.classList.remove('on')
        );

        b.classList.add('on');

        $('#tb').innerHTML = tabs[b.dataset.k];
      };

    });
  }

};


// ORDER CONFIRMATION

function done(o) {

  A.innerHTML = `

    <section class="glass c"
      style="max-width:560px;margin:6vh auto">

      <h1>Order confirmed 🎉</h1>

      <p class="mut">
        Invoice ${esc(o.invoice)} ·
        ${(o.items||[]).map(x=>`${esc(x.name)} × ${x.quantity}`).join(', ')} ·
        ₹${o.total} · ${esc(o.payment || 'Payment')} · ${esc(o.paymentStatus || 'PENDING')}
      </p>

      <br>

      <p>We will contact you on ${esc(o.phone)} soon.</p>

      <br>

      <button class="btn" onclick="go('account')">
        View my orders
      </button>

    </section>
  `;
}


// STUDENT ORDER DETAILS, REORDER, REVIEWS AND PRIVATE FEEDBACK
window.showStudentOrderDetails = function(invoice) {
  const o=(window.__cuspyloOrders||[]).find(x=>String(x.invoice)===String(invoice));
  if(!o){toast('Order details are unavailable. Refresh My Account and try again.');return;}
  const delivered=['Delivered','Completed','DELIVERED'].includes(o.status);
  const items=(o.lineItems||[]).map(i=>`<li>${esc(i.item_name||('Tooth '+i.fdi_number))} × ${Number(i.quantity||1)} — ₹${Number(i.line_total||0).toFixed(2)}</li>`).join('') || (o.items||[]).map(i=>`<li>${esc(i.name||'Product')} × ${Number(i.quantity||1)}</li>`).join('');
  const reviewable=(o.lineItems||[]).filter(i=>i.product_id);
  A.innerHTML=`<section class="glass info-page order-detail-page"><button class="text-action" onclick="go('account')">← Back to order history</button><h2>Order details</h2><p><b>${esc(o.invoice)}</b> · <span class="order-status-pill">${esc(o.status)}</span></p><p class="mut">${new Date(o.date).toLocaleString('en-IN')} · ${esc(o.payment||'COD')}</p><h3>Product summary</h3><ul>${items||'<li>Order items unavailable</li>'}</ul><p><b>Total: ₹${Number(o.total||0).toFixed(2)}</b></p><div class="order-detail-links"><button class="text-action" onclick="toggleOrderTrack('${esc(o.invoice)}')">Track My Order →</button><button class="text-action" onclick="viewStudentInvoice('${esc(o.invoice)}')">Download / View Invoice →</button>${delivered?`<button class="text-action" onclick="reorderStudentOrder('${esc(o.invoice)}')">Order Again →</button>`:''}</div><div class="student-tracking-panel" id="track-${esc(o.invoice)}"><h4>Order journey</h4>${renderStudentTimeline(o)}</div>${delivered?`<section class="order-followup"><h3>Product review</h3>${reviewable.length?reviewable.map(i=>`<form class="review-form" data-product-id="${i.product_id}" data-order-id="${o.id}"><b>${esc(i.item_name)}</b><label>Rating <select name="rating" required><option value="5">★★★★★ — Excellent</option><option value="4">★★★★ — Good</option><option value="3">★★★ — Average</option><option value="2">★★ — Poor</option><option value="1">★ — Very poor</option></select></label><textarea name="review_text" maxlength="2000" placeholder="Share your experience (optional)"></textarea><button class="text-action">Submit review →</button></form>`).join(''):'<p class="mut">Product reviews are available for catalogue products purchased through CUSPYLO.</p>'}</section><section class="order-followup"><h3>Private feedback</h3><p class="mut">Only the CUSPYLO admin team can see this feedback.</p><form id="order-private-feedback"><textarea name="message" required maxlength="1200" placeholder="Tell us about your order or experience"></textarea><button class="text-action">Send private feedback →</button></form></section>`:''}<p><button class="text-action" onclick="go('account')">← Back to order history</button></p></section>`;
  document.querySelectorAll('.review-form').forEach(form=>form.onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(form));try{const r=await fetch(`/api/products/${form.dataset.productId}/reviews`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({...b,order_id:Number(form.dataset.orderId)})});const d=await r.json();if(!r.ok)throw Error(d.error||'Unable to submit review');toast(d.message||'Review submitted for approval.');form.reset();}catch(x){toast(x.message);}});
  const feedback=document.getElementById('order-private-feedback');if(feedback)feedback.onsubmit=async e=>{e.preventDefault();try{const b=Object.fromEntries(new FormData(feedback));const r=await fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({...b,order_id:o.id})});const d=await r.json();if(!r.ok)throw Error(d.error||'Unable to send feedback');toast('Private feedback sent to CUSPYLO.');feedback.reset();}catch(x){toast(x.message);}};
};
window.reorderStudentOrder=function(invoice){const o=(window.__cuspyloOrders||[]).find(x=>String(x.invoice)===String(invoice));if(!o)return;const lines=(o.lineItems||[]).filter(i=>i.product_id);if(!lines.length){toast('This historical order does not contain catalogue product IDs and cannot be reordered automatically.');return;}lines.forEach(i=>{const found=cart.find(x=>x.product_id===Number(i.product_id));if(found)found.quantity=Math.min(99,found.quantity+Number(i.quantity||1));else cart.push({product_id:Number(i.product_id),name:i.item_name,price:Number(i.unit_price||0),quantity:Number(i.quantity||1),image:''});});saveCart();if(!confirm('Items from this order have been added to your cart. Continue to checkout?')){go('account');return;}go('cart');};
function renderStudentTimeline(o){const steps=[['RECEIVED','Order Received'],['PACKED','Packed'],['OUT_FOR_DELIVERY','Out for Delivery'],['DELIVERED','Delivered']];const history=Array.isArray(o.tracking)?o.tracking:[];const map=v=>({'Received':'RECEIVED','Packed':'PACKED','Out for Delivery':'OUT_FOR_DELIVERY','Delivered':'DELIVERED','Completed':'DELIVERED'}[v]||v);const current=map(o.status);const idx=steps.findIndex(x=>x[0]===current);return `<div class="tracking-timeline">${steps.map((st,i)=>{const h=history.find(x=>map(x.status||x.new_status)===st[0]);return `<div class="track-step ${i<=idx?'is-complete':''} ${i===idx?'is-current':''}"><span class="track-marker">${i<=idx?'✓':i+1}</span><div class="track-copy"><b>${st[1]}</b><small>${h?.at?new Date(h.at).toLocaleString('en-IN'):(i<=idx?'Completed':'Awaiting update')}</small></div></div>`;}).join('')}</div>`;}

// STUDENT ORDER TRACKING + INVOICE
function toggleOrderTrack(invoice) {
  const panel = document.getElementById('track-' + CSS.escape(invoice));
  if (!panel) return;
  panel.hidden = !panel.hidden;
  const button = [...document.querySelectorAll('.student-order-actions button')].find(b => b.getAttribute('onclick') === `toggleOrderTrack('${invoice}')`);
  if (button) button.textContent = panel.hidden ? 'Track My Order' : 'Hide Tracking';
}

async function viewStudentInvoice(invoice) {
  try {
    const orders = (await api('/my/orders')).orders || [];
    const o = orders.find(order => order.invoice === invoice);
    if (!o) return toast('Invoice could not be found.');
    const rows = (o.lineItems || []).map(item => {
      const name = item.item_name || (item.fdi_number ? `Tooth ${item.fdi_number}` : 'Item');
      return `<tr><td>${esc(name)}</td><td>${Number(item.quantity || 1)}</td><td>₹${Number(item.unit_price || 0).toFixed(2)}</td><td>₹${Number(item.line_total || 0).toFixed(2)}</td></tr>`;
    }).join('') || (o.items || []).map(i => `<tr><td>${esc(i.name||'Product')}</td><td>${Number(i.quantity||1)}</td><td>₹${Number(i.price||0).toFixed(2)}</td><td>₹${(Number(i.price||0)*Number(i.quantity||1)).toFixed(2)}</td></tr>`).join('');
    const w = window.open('', '_blank');
    if (!w) return toast('Allow pop-ups to view the invoice.');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.invoice)} - CUSPYLO Invoice</title><style>body{font:14px Arial,sans-serif;color:#142b46;max-width:760px;margin:40px auto;padding:0 24px}header{display:flex;justify-content:space-between;align-items:start;border-bottom:2px solid #0b2545;padding-bottom:18px}h1{margin:0;color:#0b2545}small,.muted{color:#64748b}.meta{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:26px 0}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:12px;border-bottom:1px solid #dbe4ee;text-align:left}th{background:#f1f6fa}.total{text-align:right;font-size:20px;font-weight:bold;margin-top:20px}.actions{margin:24px 0}@media print{.actions{display:none}body{margin:0}}</style></head><body><header><div><h1>CUSPYLO</h1><p class="muted">The Pie Product</p></div><div><h2>INVOICE</h2><b>${esc(o.invoice)}</b><p>${new Date(o.date).toLocaleString('en-IN')}</p></div></header><section class="meta"><div><b>Bill to</b><p>${esc(o.name || user?.name)}<br>${esc(o.phone || user?.phone)}<br>${esc(o.email || user?.email)}<br>${esc(o.college || user?.college)}<br>${esc(o.address || '')}</p></div><div><b>Payment details</b><p>Method: ${esc(o.payment || 'COD')}<br>Payment status: ${esc(o.paymentStatus || 'PENDING')}<br>Order status: ${esc(o.status)}</p></div></section><table><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><p class="total">Total: ₹${Number(o.total || 0).toFixed(2)}</p><p class="muted">Thank you for choosing CUSPYLO.</p><div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div></body></html>`);
    w.document.close();
  } catch (e) { toast(e.message || 'Unable to open invoice.'); }
}

// ADMIN INVOICE

function inv(i) {
  const o = window.AD?.orders?.[i];
  if (!o) return toast('Order details are unavailable. Refresh the admin portal and try again.');

  // Open synchronousFly from the admin button click to avoid popup blocking.
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups for localhost to open the invoice.');

  const rows = (o.lineItems || []).map(item => {
    const name = item.item_name || (item.fdi_number ? `Tooth ${item.fdi_number}` : 'Product');
    const quantity = Number(item.quantity || 1);
    const unitPrice = Number(item.unit_price || 0);
    const lineTotal = Number(item.line_total ?? unitPrice * quantity);
    return `<tr><td>${esc(name)}</td><td>${quantity}</td><td>₹${unitPrice.toFixed(2)}</td><td>₹${lineTotal.toFixed(2)}</td></tr>`;
  }).join('') || (o.items || []).map(item => {
    const quantity = Number(item.quantity || 1);
    const unitPrice = Number(item.price || 0);
    return `<tr><td>${esc(item.name || 'Product')}</td><td>${quantity}</td><td>₹${unitPrice.toFixed(2)}</td><td>₹${(unitPrice * quantity).toFixed(2)}</td></tr>`;
  }).join('');

  w.document.open();
  w.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(o.invoice || 'CUSPYLO Invoice')}</title>
<style>
  body{font:14px Arial,sans-serif;color:#142b46;max-width:760px;margin:40px auto;padding:0 24px}
  header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0b2545;padding-bottom:18px}
  h1{margin:0;color:#0b2545}small,.muted{color:#64748b}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:26px 0}
  table{width:100%;border-collapse:collapse;margin-top:24px}
  th,td{padding:12px;border-bottom:1px solid #dbe4ee;text-align:left}
  th{background:#f1f6fa}.total{text-align:right;font-size:20px;font-weight:bold;margin-top:20px}
  .actions{margin:24px 0;display:flex;gap:10px}
  button{padding:10px 16px;border:0;border-radius:8px;background:#0b2545;color:#fff;cursor:pointer}
  @media print{.actions{display:none}body{margin:0}}
</style>
</head>
<body>
<header>
  <div><h1>CUSPYLO</h1><p class="muted">The Pie Product</p></div>
  <div><h2>INVOICE</h2><b>${esc(o.invoice || '')}</b><p>${o.date ? new Date(o.date).toLocaleString('en-IN') : ''}</p></div>
</header>
<section class="meta">
  <div><b>Bill to</b><p>${esc(o.name || '')}<br>${esc(o.phone || '')}<br>${esc(o.email || '')}<br>${esc(o.college || '')}<br>${esc(o.address || '')}</p></div>
  <div><b>Payment details</b><p>Method: ${esc(o.payment || 'Cash on delivery')}<br>Payment status: ${esc(o.paymentStatus || 'PENDING')}<br>Order status: ${esc(o.status || '')}</p></div>
</section>
<table>
  <thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4">Order item details unavailable</td></tr>'}</tbody>
</table>
<p class="total">Total: ₹${Number(o.total || 0).toFixed(2)}</p>
<p class="muted">Thank you for choosing CUSPYLO.</p>
<div class="actions"><button type="button" onclick="window.print()">Print / Save as PDF</button><button type="button" onclick="window.close()">Close</button></div>
</body>
</html>`);
  w.document.close();
}


// FEEDBACK FORM

$('#fb').onsubmit = async e => {

  e.preventDefault();

  try {

    await api('/feedback', Object.fromEntries(new FormData(e.target)));

    e.target.reset();

    toast('Thanks for your feedback!');

  } catch (x) {
    toast(x.message);
  }
};



// Wishlist heart controls are delegated so they work on dynamically rendered cards.
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-wishlist-product], [data-wishlist-kit]');
  if (!button) return;
  if (role !== 'user' || !token) { after = sessionStorage.getItem('cuspylo_view') || 'wishlist'; go('auth'); return; }
  const type = button.hasAttribute('data-wishlist-kit') ? 'kit' : 'product';
  const id = button.getAttribute(type === 'kit' ? 'data-wishlist-kit' : 'data-wishlist-product');
  if (!id) return;
  const key = wishlistKey(type, id);
  const exists = wishlistKeys.has(key);
  button.disabled = true;
  try {
    if (exists) {
      const response = await fetch(`/api/wishlist/${type}/${id}`, {method:'DELETE',headers:{Authorization:'Bearer '+token}});
      const data = await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(data.error || 'Unable to remove item.');
      wishlistKeys.delete(key);
      toast('Removed from wishlist.');
      // If the student deselects a heart on the Wishlist page, remove that card immediately.
      if (sessionStorage.getItem('cuspylo_view') === 'wishlist') {
        go('wishlist');
        return;
      }
    } else {
      const data = await api('/wishlist', {item_type:type,item_id:Number(id)});
      if (data?.error) throw new Error(data.error);
      wishlistKeys.add(key);
      toast('Added to wishlist.');
    }
    applyWishlistHeartState(A);
  } catch(error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

// INITIALIZE APPLICATION

(async () => {

  try {
    cfg = await api('/config');
  } catch (e) {
    toast('Could not connect to CUSPYLO backend.');
  }

  const waNumber = String(cfg.whatsapp || '').replace(/\D/g, '');

  const wa = waNumber.length >= 10
    ? 'https://wa.me/' + waNumber + '?text=Hi%20CUSPYLO'
    : '#contact';

  if ($('#wa2')) $('#wa2').href = wa;

  if ($('#em')) {
    $('#em').innerHTML = cfg.email ? `<a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a>` : '';
  }
  if ($('#ig-footer')) $('#ig-footer').href = cfg.instagram || 'https://www.instagram.com/cuspylo/';

  head();
  if (authWatch) clearInterval(authWatch);
  authWatch = setInterval(() => { if (role === 'user' && token) api('/me').catch(() => {}); }, 15000);

  const savedPage = sessionStorage.getItem('cuspylo_view');

go(
  role === 'admin'
    ? 'admin'
    : savedPage && savedPage !== 'admin' && savedPage !== 'product-detail'
      ? savedPage
      : role === 'user'
        ? 'dash'
        : 'home'
);

const initialProductId = new URLSearchParams(location.search).get('product');
if (initialProductId) {
  fetch('/api/products').then(r => r.json()).then(d => {
    const p = (d.products || []).find(x => String(x.id) === String(initialProductId));
    if (p) renderProductDetail(p);
  }).catch(() => {});
}

})();
window.addEventListener('popstate', async () => {
  const id=new URLSearchParams(location.search).get('product');
  if(id){try{const r=await fetch('/api/products');const d=await r.json();const p=(d.products||[]).find(x=>String(x.id)===String(id));if(p)renderProductDetail(p);}catch{}}
  else {const v=sessionStorage.getItem('cuspylo_view')||'dash';if(v==='product-detail')go('dash');else go(v);}
});

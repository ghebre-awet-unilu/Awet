/*
 * Shared helpers for talking to booking_api.
 * The API address comes from hugo.toml -> [params] apiBase.
 */
(function () {
  'use strict';

  function meta(name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el ? el.getAttribute('content') : '';
  }

  var API_BASE = (meta('luxe-api') || 'http://localhost:3000').replace(/\/$/, '');
  var SITE_BASE = meta('luxe-base') || '/';
  if (SITE_BASE.slice(-1) !== '/') SITE_BASE += '/';

  var SESSION_KEY = 'luxeAdmin';

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function siteUrl(path) {
    return SITE_BASE + String(path || '').replace(/^\//, '');
  }

  // "/images/a.png" -> "/luxehome/images/a.png"; data: and http(s) URLs unchanged.
  function imageUrl(path) {
    path = String(path || '').trim();
    if (!path) return '';
    if (/^(https?:|data:)/i.test(path)) return path;
    return siteUrl(path);
  }

  function propertyUrl(id) {
    return siteUrl('property/?id=' + encodeURIComponent(id));
  }

  // ---------- admin session ----------

  function getSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!s || !s.token || !s.expiresAt || s.expiresAt <= Date.now()) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  function setSession(data) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      email: data.email,
      token: data.token,
      expiresAt: data.expiresAt
    }));
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function goToLogin() {
    clearSession();
    window.location.replace(siteUrl('admin/'));
  }

  // ---------- requests ----------

  function request(path, options) {
    options = options || {};
    var headers = { 'Content-Type': 'application/json' };
    if (options.auth) {
      var s = getSession();
      if (s) headers.Authorization = 'Bearer ' + s.token;
    }

    return fetch(API_BASE + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    })
      .catch(function () {
        throw new Error('Cannot reach the server. Is booking_api running?');
      })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (res.status === 401 && options.auth) {
            goToLogin();
            throw new Error('Session expired. Please log in again.');
          }
          if (!res.ok || !data.ok) {
            throw new Error(data.error || ('Request failed (' + res.status + ')'));
          }
          return data;
        });
      });
  }

  // ---------- property card (same markup as the Hugo templates) ----------

  function cardHtml(p) {
    var status = p.status || '';
    var badge = status === 'For Rent' ? 'badge-rent' : 'badge-sale';
    var img = imageUrl(p.image_path);
    var desc = String(p.description || '');
    if (desc.length > 100) desc = desc.slice(0, 100).replace(/\s+\S*$/, '') + '…';

    return (
      '<div class="property-card"' +
        ' data-title="' + escapeHtml(String(p.title || '').toLowerCase()) + '"' +
        ' data-location="' + escapeHtml(String(p.location || '').toLowerCase()) + '"' +
        ' data-type="' + escapeHtml(p.type) + '"' +
        ' data-status="' + escapeHtml(status) + '">' +
        '<div class="card-image">' +
          (img
            ? '<img src="' + escapeHtml(img) + '" alt="' + escapeHtml(p.title) + '" loading="lazy">'
            : '<div class="card-image-placeholder"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg></div>') +
          '<span class="card-badge ' + badge + '">' + escapeHtml(status) + '</span>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="card-type">' + escapeHtml(p.type) + '</div>' +
          '<h3 class="card-title">' + escapeHtml(p.title) + '</h3>' +
          '<p class="card-location">' + escapeHtml(p.location) + '</p>' +
          '<p class="card-desc">' + escapeHtml(desc) + '</p>' +
          '<div class="card-meta">' +
            (p.bedrooms ? '<span>' + escapeHtml(p.bedrooms) + ' bed</span>' : '') +
            (p.bathrooms ? '<span>' + escapeHtml(p.bathrooms) + ' bath</span>' : '') +
            (p.area ? '<span>' + escapeHtml(p.area) + 'm²</span>' : '') +
          '</div>' +
          '<div class="card-footer">' +
            '<span class="card-price">' + escapeHtml(p.price) + '</span>' +
            '<a href="' + escapeHtml(propertyUrl(p.id)) + '" class="btn btn-sm btn-primary">View Details</a>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  window.LuxeAPI = {
    base: API_BASE,
    siteUrl: siteUrl,
    imageUrl: imageUrl,
    propertyUrl: propertyUrl,
    escapeHtml: escapeHtml,
    request: request,
    getSession: getSession,
    setSession: setSession,
    clearSession: clearSession,
    goToLogin: goToLogin,
    cardHtml: cardHtml
  };
})();

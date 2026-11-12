/*
 * Property booking: guest enters name + email, the API creates a PayPal order
 * (price taken from the database) and we redirect to PayPal.
 * Also renders the database-driven detail page /property/?id=123.
 */
(function () {
  'use strict';

  var api = window.LuxeAPI;
  if (!api) return;

  function parsePrice(price) {
    var m = String(price || '').replace(/,/g, '').match(/\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  }

  function euro(n) {
    return '€' + Number(n).toLocaleString('en-IE', { maximumFractionDigits: 2 });
  }

  // Must match bookingAmount() in booking_api/server.js
  function amountInfo(box) {
    var price = box.dataset.price || '';
    var isRent = box.dataset.status === 'For Rent' || /month/i.test(price);
    if (isRent) {
      return { label: 'First month’s rent', amount: parsePrice(price) };
    }
    return { label: 'Reservation deposit', amount: Number(box.dataset.deposit) || 0 };
  }

  function initBookingBox(box) {
    var bookBtn  = document.getElementById('bookPropertyBtn');
    var form     = document.getElementById('bookingForm');
    var cancel   = document.getElementById('bookingCancel');
    var submit   = document.getElementById('bookingSubmit');
    var errorEl  = document.getElementById('bookingError');
    if (!bookBtn || !form) return;

    function showError(text) {
      errorEl.textContent = text;
      errorEl.hidden = false;
    }

    bookBtn.addEventListener('click', function () {
      var info = amountInfo(box);
      if (!info.amount) {
        alert('This property has no valid price. Please contact us instead.');
        return;
      }
      document.getElementById('bookingAmountLabel').textContent = info.label;
      document.getElementById('bookingAmount').textContent = euro(info.amount);
      errorEl.hidden = true;
      bookBtn.hidden = true;
      form.hidden = false;
      document.getElementById('bookingName').focus();
    });

    cancel.addEventListener('click', function () {
      form.hidden = true;
      bookBtn.hidden = false;
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorEl.hidden = true;

      var name  = document.getElementById('bookingName').value.trim();
      var email = document.getElementById('bookingEmail').value.trim();
      if (!name) return showError('Please enter your name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return showError('Please enter a valid email address.');
      }

      submit.disabled = true;
      submit.textContent = 'Starting payment…';

      var body = { guest_name: name, guest_email: email };
      if (box.dataset.propertyId) body.property_id = box.dataset.propertyId;
      else body.property_title = box.dataset.propertyTitle;

      api.request('/api/paypal/create-order', { method: 'POST', body: body })
        .then(function (data) {
          window.location.href = data.approveUrl;
        })
        .catch(function (err) {
          showError(err.message);
          submit.disabled = false;
          submit.textContent = 'Continue to PayPal';
        });
    });
  }

  // ---------- /property/?id=123 ----------

  function renderDetail(p) {
    var esc = api.escapeHtml;
    document.title = p.title + ' | LuxeHome Real Estate';
    document.getElementById('pdCrumb').textContent = p.title;
    document.getElementById('pdTitle').textContent = p.title;
    document.getElementById('pdType').textContent = p.type || '';
    document.getElementById('pdLocation').textContent = p.location ? '📍 ' + p.location : '';
    document.getElementById('pdPrice').textContent = p.price || '';

    var badge = document.getElementById('pdBadge');
    badge.textContent = p.status || '';
    badge.className = 'card-badge ' + (p.status === 'For Rent' ? 'badge-rent' : 'badge-sale');

    var img = api.imageUrl(p.image_path);
    document.getElementById('pdImage').innerHTML = img
      ? '<img src="' + esc(img) + '" alt="' + esc(p.title) + '">'
      : '<div class="detail-image-placeholder"><p>' + esc(p.title) + '</p></div>';

    var specs = '';
    if (p.bedrooms) specs += '<div class="spec-item"><span class="spec-icon">&#127978;</span><span class="spec-val">' + esc(p.bedrooms) + '</span><span class="spec-lbl">Bedrooms</span></div>';
    if (p.bathrooms) specs += '<div class="spec-item"><span class="spec-icon">&#128716;</span><span class="spec-val">' + esc(p.bathrooms) + '</span><span class="spec-lbl">Bathrooms</span></div>';
    if (p.area) specs += '<div class="spec-item"><span class="spec-icon">&#9632;</span><span class="spec-val">' + esc(p.area) + 'm²</span><span class="spec-lbl">Floor Area</span></div>';
    document.getElementById('pdSpecs').innerHTML = specs;

    var body = String(p.description || '')
      .split(/\n{2,}/)
      .filter(Boolean)
      .map(function (para) { return '<p>' + esc(para) + '</p>'; })
      .join('');
    body += videoHtml(p.video_url);
    document.getElementById('pdBody').innerHTML = body;

    var box = document.getElementById('bookingBox');
    box.dataset.propertyId = p.id;
    box.dataset.propertyTitle = p.title;
    box.dataset.price = p.price || '';
    box.dataset.status = p.status || '';
  }

  function videoHtml(url) {
    url = String(url || '').trim();
    if (!/^https?:\/\//i.test(url)) return '';
    var yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
    if (yt) {
      return '<div class="pd-video"><iframe src="https://www.youtube.com/embed/' + yt[1] +
        '" title="Property video" allowfullscreen loading="lazy"></iframe></div>';
    }
    return '<div class="pd-video"><video src="' + api.escapeHtml(url) + '" controls preload="metadata"></video></div>';
  }

  var detail = document.getElementById('propertyDetail');
  var box = document.getElementById('bookingBox');

  if (detail) {
    var statusEl = document.getElementById('pdStatus');
    var id = new URLSearchParams(window.location.search).get('id');

    if (!id) {
      statusEl.textContent = 'No property selected.';
    } else {
      api.request('/api/properties/' + encodeURIComponent(id))
        .then(function (data) {
          renderDetail(data.property);
          statusEl.hidden = true;
          detail.hidden = false;
          initBookingBox(box);
        })
        .catch(function (err) {
          statusEl.textContent = err.message;
          document.getElementById('pdCrumb').textContent = 'Not found';
        });
    }
  } else if (box) {
    initBookingBox(box);
  }
})();

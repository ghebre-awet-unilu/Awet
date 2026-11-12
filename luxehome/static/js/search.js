
/* ---------- Contact form ---------- */

window.handleFormSubmit = function (e) {
  e.preventDefault();
  var form    = e.target;
  var success = document.getElementById('formSuccess');
  var error   = document.getElementById('formError');
  var btn     = form.querySelector('button[type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  if (error) { error.style.display = 'none'; }

  window.LuxeAPI.request('/api/contact', {
    method: 'POST',
    body: {
      firstName: form.firstName.value,
      lastName:  form.lastName.value,
      email:     form.email.value,
      phone:     form.phone.value,
      interest:  form.interest.value,
      message:   form.message.value
    }
  })
    .then(function () {
      form.reset();
      if (btn)     { btn.style.display = 'none'; }
      if (success) { success.style.display = 'block'; }
    })
    .catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Send Message'; }
      if (error) {
        error.textContent = err.message;
        error.style.display = 'block';
      }
    });
};


/* ---------- Properties page: live data + search/filter ---------- */

(function () {
  'use strict';

  var searchInput  = document.getElementById('searchInput');
  var filterType   = document.getElementById('filterType');
  var filterStatus = document.getElementById('filterStatus');
  var clearBtn     = document.getElementById('clearFilters');
  var grid         = document.getElementById('propertyGrid');
  var noResults    = document.getElementById('noResults');
  var resultsCount = document.getElementById('resultsCount');

  if (!grid) return;

  function filterProperties() {
    var query  = searchInput  ? searchInput.value.trim().toLowerCase()  : '';
    var type   = filterType   ? filterType.value   : '';
    var status = filterStatus ? filterStatus.value : '';

    var cards   = grid.querySelectorAll('.property-card');
    var visible = 0;

    cards.forEach(function (card) {
      var title    = (card.dataset.title    || '').toLowerCase();
      var location = (card.dataset.location || '').toLowerCase();
      var cardType = (card.dataset.type     || '');
      var cardStat = (card.dataset.status   || '');

      var matchQuery  = !query  || title.includes(query) || location.includes(query) || cardType.toLowerCase().includes(query);
      var matchType   = !type   || cardType === type;
      var matchStatus = !status || cardStat === status;

      var show = matchQuery && matchType && matchStatus;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });

    if (noResults) {
      noResults.style.display = visible === 0 ? 'block' : 'none';
    }

    if (resultsCount) {
      var total = cards.length;
      resultsCount.textContent = visible === total
        ? total + ' propert' + (total === 1 ? 'y' : 'ies') + ' available'
        : 'Showing ' + visible + ' of ' + total + ' properties';
    }
  }

  function rebuildTypeOptions(properties) {
    if (!filterType) return;
    var current = filterType.value;
    var types = [];
    properties.forEach(function (p) {
      if (p.type && types.indexOf(p.type) === -1) types.push(p.type);
    });
    types.sort();
    filterType.innerHTML = '<option value="">All Types</option>' + types.map(function (t) {
      var safe = window.LuxeAPI.escapeHtml(t);
      return '<option value="' + safe + '">' + safe + '</option>';
    }).join('');
    filterType.value = types.indexOf(current) !== -1 ? current : '';
  }

  window.clearAllFilters = function () {
    if (searchInput)  searchInput.value  = '';
    if (filterType)   filterType.value   = '';
    if (filterStatus) filterStatus.value = '';
    filterProperties();
  };

  if (searchInput)  searchInput.addEventListener('input',  filterProperties);
  if (filterType)   filterType.addEventListener('change',  filterProperties);
  if (filterStatus) filterStatus.addEventListener('change', filterProperties);
  if (clearBtn)     clearBtn.addEventListener('click', window.clearAllFilters);

  filterProperties();

  // Replace the static (build-time) cards with the latest data from the database.
  // If the API is offline, the static cards stay on the page.
  window.LuxeAPI.request('/api/properties')
    .then(function (data) {
      var list = data.properties || [];
      grid.innerHTML = list.map(window.LuxeAPI.cardHtml).join('');
      rebuildTypeOptions(list);
      filterProperties();
    })
    .catch(function () { /* keep static listings */ });
})();


/* ---------- Home page: featured homes from the database ---------- */

(function () {
  'use strict';

  var grid = document.getElementById('featuredGrid');
  if (!grid) return;

  window.LuxeAPI.request('/api/properties')
    .then(function (data) {
      var list = (data.properties || []).slice().sort(function (a, b) {
        return (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
      });
      if (list.length) grid.innerHTML = list.slice(0, 3).map(window.LuxeAPI.cardHtml).join('');
    })
    .catch(function () { /* keep static listings */ });
})();

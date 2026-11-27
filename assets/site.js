'use strict';

/* The catalog website's filters. Source: cdam-ink-stories _tools/site/site.js,
   copied verbatim into the catalog by catalog_build.py. Design:
   choosatron-esp32-s3 docs/story-catalog-spec.md section 14.

   EVERY WORK IS ALREADY IN THE PAGE. This only hides and shows rows by the
   data- attributes the generator wrote, and swaps a row's title, blurb and
   download to the chosen language from the #catalog-data block. It never
   fetches index.json, so without it the page is the whole catalog in its
   original languages, which is the point.

   The rules are the device Catalog tab's (data/source/www/js/catalog.js),
   section 7.4: languages match on primary subtag and script, region ignored,
   zh-Hans and zh-Hant apart; "All languages" is one visible control away; the
   filter state lives in the query string so a filtered view can be linked. */
(function () {
   // How recently a work joined to count as new. catalog.js NEW_WINDOW_DAYS.
   var NEW_WINDOW_DAYS = 30;
   var DAY_MS = 86400000;
   // G < PG < PG-13 < R < NC-17; anything else, NR included, only under "any".
   var RATING_RANK = { 'G': 0, 'PG': 1, 'PG-13': 2, 'R': 3, 'NC-17': 4 };

   function $( id ) { return document.getElementById( id ); }

   var data = {};
   try {
      data = JSON.parse( $( 'catalog-data' ).textContent );
   } catch (e) {
      return; // no data, no filters: the page is still the whole catalog
   }

   /* Languages.key() in the device's languages.js: primary subtag and script,
      region dropped. */
   function key( tag ) {
      var parts = String( tag || '' ).toLowerCase().split( '-' );
      var out = parts.length ? [parts[0]] : [];
      for (var i = 1; i < parts.length; i++) {
         if (parts[i].length === 4 && !/^[0-9]+$/.test( parts[i] )) out.push( parts[i] );
      }
      return out.join( '-' );
   }

   /* A browser says zh-CN or zh-TW far more often than zh-Hans or zh-Hant.
      The region is the only hint at the script, so read it - here only, where
      a reader's preference is being guessed, never when matching an edition. */
   function readerKey( tag ) {
      var k = key( tag );
      if (k !== 'zh') return k;
      var region = String( tag ).split( '-' ).slice( 1 ).join( '-' ).toUpperCase();
      if (/(^|-)(CN|SG|MY)$/.test( region )) return 'zh-hans';
      if (/(^|-)(TW|HK|MO)$/.test( region )) return 'zh-hant';
      return k;
   }

   function readerLanguages() {
      var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
      return Array.prototype.slice.call( list ).filter( Boolean );
   }

   /* The reader's first language that the catalog has, else '' - "All
      languages" rather than an empty page. */
   function defaultLang( offered ) {
      var langs = readerLanguages();
      for (var i = 0; i < langs.length; i++) {
         if (offered.indexOf( readerKey( langs[i] ) ) >= 0) return readerKey( langs[i] );
      }
      return '';
   }

   function params() {
      var out = {};
      var q = location.search.replace( /^\?/, '' );
      if (!q) return out;
      q.split( '&' ).forEach( function ( pair ) {
         var at = pair.indexOf( '=' );
         var k = decodeURIComponent( ( at < 0 ? pair : pair.slice( 0, at ) ).replace( /\+/g, ' ' ) );
         var v = at < 0 ? '' : decodeURIComponent( pair.slice( at + 1 ).replace( /\+/g, ' ' ) );
         out[k] = v;
      } );
      return out;
   }

   /* The edition a row or page shows for language key `lang`: the original
      when it is in that language, else the first that is. '' means the
      original. */
   function editionFor( work, lang ) {
      var eds = ( data[work] && data[work].e ) || [];
      var i;
      for (i = 0; i < eds.length; i++) if (eds[i].orig && ( !lang || eds[i].key === lang )) return eds[i];
      for (i = 0; i < eds.length; i++) if (eds[i].key === lang) return eds[i];
      return null;
   }

   function blurbFor( work, edition ) {
      var b = ( data[work] && data[work].b ) || {};
      var orig = editionFor( work, '' );
      if (edition && b[edition.lang]) return { text: b[edition.lang], lang: edition.lang };
      if (orig && b[orig.lang]) return { text: b[orig.lang], lang: orig.lang };
      return null;
   }

   function showBlurb( el, blurb ) {
      if (!el) return;
      el.hidden = !blurb;
      el.textContent = blurb ? blurb.text : '';
      if (blurb) el.setAttribute( 'lang', blurb.lang );
   }

   /* ---------------- one work's page ---------------- */

   function workPage() {
      var article = document.querySelector( '.work-page' );
      var work = article.getAttribute( 'data-work' );
      var p = params();
      var offered = ( ( data[work] && data[work].e ) || [] ).map( function ( e ) { return e.key; } );
      var lang = Object.prototype.hasOwnProperty.call( p, 'lang' )
         ? ( p.lang === 'all' ? '' : key( p.lang ) )
         : defaultLang( offered );
      var ed = lang ? editionFor( work, lang ) : null;

      if (ed) {
         var h1 = article.querySelector( '.work-title' );
         h1.textContent = ed.title;
         h1.setAttribute( 'lang', ed.lang );
         document.title = ed.title + ' — Choosatron Stories';
         showBlurb( article.querySelector( '.blurb' ), blurbFor( work, ed ) );
         var rows = article.querySelectorAll( 'tr[data-key]' );
         for (var i = 0; i < rows.length; i++) {
            if (rows[i].getAttribute( 'data-key' ) === lang) rows[i].classList.add( 'match' );
         }
      }
      // Back to the list as it was filtered.
      if (location.search) $( 'back' ).href = '../../' + location.search;
      reportForm( article, work, ed );
   }

   /* ---------------- report a problem (cdam-f3g.23) ---------------- */

   /* The relay the device's own "Report a problem" posts to: REPORT_URL in
      choosatron-esp32-s3 data/source/www/js/report.js. A Cloudflare Worker
      (choosatron/bug-reports, relay/) that files it as a private issue; it
      answers any origin. */
   var REPORT_URL = 'https://choosatron-bug-relay.choosatron.workers.dev/report';

   function reportForm( article, work, shown ) {
      var box = $( 'report' );
      if (!box || !window.fetch) return;
      var rows = article.querySelectorAll( 'tr[data-ifid]' );
      var sel = $( 'rp-edition' ), type = $( 'rp-type' ), status = $( 'rp-status' );
      var eds = {};
      for (var i = 0; i < rows.length; i++) {
         var r = rows[i];
         var ed = { ifid: r.getAttribute( 'data-ifid' ), language: r.getAttribute( 'data-lang' ),
                    version: r.getAttribute( 'data-version' ), translation: r.getAttribute( 'data-translation' ),
                    title: r.querySelector( '.ed-title' ).textContent };
         eds[ed.ifid] = ed;
         var o = document.createElement( 'option' );
         o.value = ed.ifid;
         o.textContent = r.querySelector( '.ed-lang' ).textContent;
         if (shown ? r.getAttribute( 'data-key' ) === shown.key && !sel.querySelector( '[selected]' )
                   : ed.translation === 'original') o.setAttribute( 'selected', '' );
         sel.appendChild( o );
      }

      function say( kind, text ) {
         status.hidden = !kind;
         status.className = 'status ' + ( kind || '' );
         status.textContent = text || '';
      }

      function refresh() {
         var t = type.value;
         $( 'rp-translation' ).hidden = t !== 'translation';
         $( 'rp-contact-label' ).textContent = t === 'author'
            ? 'Your email, so we can reply (required)'
            : 'Your email, if you would like a reply (optional)';
      }

      // A translation is most likely a translation problem; an original, a story one.
      function guessType() {
         var ed = eds[sel.value];
         if (type.value === 'story' || type.value === 'translation') {
            type.value = ed && ed.translation !== 'original' ? 'translation' : 'story';
         }
         refresh();
      }

      sel.addEventListener( 'change', guessType );
      type.addEventListener( 'change', refresh );
      $( 'rp-form' ).addEventListener( 'submit', function ( ev ) {
         ev.preventDefault();
         var text = $( 'rp-text' ).value.trim(), contact = $( 'rp-contact' ).value.trim();
         if (text.length < 5) { say( 'bad', 'Please say a little about what happened.' ); return; }
         if (type.value === 'author' && contact.indexOf( '@' ) < 1) {
            say( 'bad', 'Please give an email address, so we can reply.' );
            return;
         }
         var ed = eds[sel.value] || {};
         var report = {
            app: 'choosatron', source: 'catalog', type: type.value, text: text, contact: contact,
            page_lang: document.documentElement.lang || 'en',
            story: { title: ed.title, work_title: article.getAttribute( 'data-title' ) || '',
                     author: article.getAttribute( 'data-author' ) || '', work: work, ifid: ed.ifid,
                     language: ed.language, version: ed.version, translation: ed.translation }
         };
         if (type.value === 'translation') {
            report.translation = { language: ed.language, shown: $( 'rp-shown' ).value.trim(),
                                   suggested: $( 'rp-suggested' ).value.trim() };
         }
         $( 'rp-send' ).disabled = true;
         say( 'busy', 'Sending…' );
         fetch( REPORT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( report ) } )
            .then( function ( res ) {
               if (res.ok) {
                  say( 'ok', 'Sent. Thank you!' );
                  [ 'rp-text', 'rp-contact', 'rp-shown', 'rp-suggested' ].forEach( function ( id ) { $( id ).value = ''; } );
               } else if (res.status === 429) {
                  say( 'bad', 'Too many reports just now. Please try again in a minute.' );
               } else {
                  say( 'bad', 'The report was refused: it may be too long.' );
               }
            }, function () {
               say( 'bad', 'Could not reach the report service. Please check your connection and try again.' );
            } ).then( function () { $( 'rp-send' ).disabled = false; } );
      } );
      guessType();
      box.hidden = false;
   }

   /* ---------------- the list ---------------- */

   function frontPage() {
      var list = $( 'works' );
      var rows = Array.prototype.slice.call( list.querySelectorAll( 'li.work' ) );
      var langSel = $( 'f-lang' ), ratingSel = $( 'f-rating' ), mpBox = $( 'f-mp' ), qBox = $( 'f-q' );
      var offered = Array.prototype.map.call( langSel.options, function ( o ) { return o.value; } )
         .filter( Boolean );
      var state = { lang: '', rating: '', mp: false, q: '' };

      function langLabel( k ) {
         for (var i = 0; i < langSel.options.length; i++) {
            if (langSel.options[i].value === k) return langSel.options[i].textContent.replace( /\s+—\s+\d+$/, '' );
         }
         return k;
      }

      function fromUrl() {
         var p = params();
         state.lang = Object.prototype.hasOwnProperty.call( p, 'lang' )
            ? ( p.lang === 'all' ? '' : key( p.lang ) )
            : defaultLang( offered );
         if (state.lang && offered.indexOf( state.lang ) < 0) state.lang = '';
         state.rating = RATING_RANK.hasOwnProperty( p.rating ) ? p.rating : '';
         state.mp = p.mp === '1';
         state.q = p.q || '';
         langSel.value = state.lang;
         ratingSel.value = state.rating;
         mpBox.checked = state.mp;
         qBox.value = state.q;
      }

      /* Written on every change, the language always - "all" included - so a
         copied link shows what the person saw rather than the next reader's
         default. */
      function toUrl() {
         var parts = ['lang=' + encodeURIComponent( state.lang || 'all' )];
         if (state.rating) parts.push( 'rating=' + encodeURIComponent( state.rating ) );
         if (state.mp) parts.push( 'mp=1' );
         if (state.q.trim()) parts.push( 'q=' + encodeURIComponent( state.q.trim() ) );
         var url = location.pathname + '?' + parts.join( '&' );
         try { history.replaceState( null, '', url ); } catch (e) { /* file: or a sandbox */ }
      }

      function langOk( li ) {
         return !state.lang || ( ' ' + li.getAttribute( 'data-langs' ) + ' ' ).indexOf( ' ' + state.lang + ' ' ) >= 0;
      }
      function ratingOk( li ) {
         if (!state.rating) return true;
         var rank = RATING_RANK[String( li.getAttribute( 'data-rating' ) ).trim().toUpperCase()];
         return rank !== undefined && rank <= RATING_RANK[state.rating];
      }
      function mpOk( li ) { return !state.mp || li.getAttribute( 'data-mp' ) === '1'; }
      function qOk( li ) {
         var q = state.q.trim().toLowerCase();
         return !q || li.getAttribute( 'data-search' ).indexOf( q ) >= 0;
      }
      function chosenOk( li ) { return ratingOk( li ) && mpOk( li ) && qOk( li ); }

      function isNew( li ) {
         var added = li.getAttribute( 'data-added' );
         var at = added ? Date.parse( added + 'T00:00:00Z' ) : NaN;
         return !isNaN( at ) && at <= Date.now() + DAY_MS && Date.now() - at < NEW_WINDOW_DAYS * DAY_MS;
      }

      /* Title, blurb and download in the filter's language; the original's
         under "All languages". */
      function dress( li ) {
         var work = li.getAttribute( 'data-work' );
         var ed = editionFor( work, state.lang ) || editionFor( work, '' );
         if (!ed) return;
         var a = li.querySelector( '.work-title a' );
         a.textContent = ed.title;
         a.setAttribute( 'lang', ed.lang );
         a.href = 'w/' + work + '/' + ( state.lang ? '?lang=' + encodeURIComponent( state.lang ) : '?lang=all' );
         showBlurb( li.querySelector( '.blurb' ), blurbFor( work, ed ) );
         var dl = li.querySelector( 'a.dl' );
         dl.href = ed.url;
         dl.setAttribute( 'download', ed.file );
         dl.querySelector( '.dl-which' ).textContent = '· ' + ed.label + ' · ' + ed.size;
      }

      function shortDate( ms ) {
         try {
            return new Date( ms ).toLocaleDateString( 'en-GB', { day: 'numeric', month: 'short' } );
         } catch (e) {
            return new Date( ms ).toISOString().slice( 0, 10 );
         }
      }

      function stories( n ) { return n + ( n === 1 ? ' story' : ' stories' ); }

      function allButton( text ) {
         return '<button type="button" class="link show-all">' + text + '</button>';
      }

      function escapeHtml( s ) {
         return String( s ).replace( /[&<>"']/g, function ( c ) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
         } );
      }

      /* Section 7.3/7.4: present only when something qualifies, under the
         same filters, saying out loud what the language filter hid. What the
         other filters hide goes unremarked, because someone chose those. */
      function renderNew() {
         var box = $( 'new' ), out = $( 'new-list' );
         var fresh = rows.filter( function ( li ) { return isNew( li ) && chosenOk( li ); } );
         var shown = fresh.filter( langOk ).sort( function ( a, b ) {
            var x = a.getAttribute( 'data-added' ), y = b.getAttribute( 'data-added' );
            return x < y ? 1 : x > y ? -1 : 0;
         } );
         var hidden = fresh.length - shown.length;
         out.innerHTML = '';
         box.hidden = !fresh.length;
         if (box.hidden) return;
         var since = shortDate( Date.now() - NEW_WINDOW_DAYS * DAY_MS );
         var line = shown.length
            ? escapeHtml( stories( shown.length ) + ' added since ' + since )
            : escapeHtml( 'Nothing new in ' + langLabel( state.lang ) + ' since ' + since );
         if (hidden) line += ' · ' + escapeHtml( hidden + ' more in other languages' ) + ' ' + allButton( 'Show all languages' );
         $( 'new-line' ).innerHTML = line;
         shown.forEach( function ( li ) {
            var copy = li.cloneNode( true );
            copy.removeAttribute( 'id' );
            copy.hidden = false;
            out.appendChild( copy );
         } );
      }

      function titleOf( li ) { return li.querySelector( '.work-title a' ).textContent; }

      function apply() {
         var shown = 0;
         rows.forEach( function ( li ) {
            var ok = langOk( li ) && chosenOk( li );
            li.hidden = !ok;
            if (ok) { shown++; dress( li ); }
         } );
         /* Sorted by the title as shown, which the language changes: German
            titles in German order. The generator's order is the original's. */
         rows.slice().sort( function ( a, b ) {
            return titleOf( a ).localeCompare( titleOf( b ) );
         } ).forEach( function ( li ) { list.appendChild( li ); } );
         var count = $( 'count' );
         var text = 'Showing ' + ( shown === rows.length ? 'all ' + stories( shown ) : shown + ' of ' + stories( rows.length ) );
         if (state.lang) {
            count.innerHTML = escapeHtml( text + ', in ' + langLabel( state.lang ) + '.' ) + ' ' +
               allButton( 'Show all languages' );
         } else {
            count.innerHTML = escapeHtml( text + ', in every language.' );
         }
         count.hidden = false;
         $( 'empty' ).hidden = shown > 0;
         renderNew();
      }

      function changed() {
         state.lang = langSel.value;
         state.rating = ratingSel.value;
         state.mp = mpBox.checked;
         state.q = qBox.value;
         toUrl();
         apply();
      }

      function allLanguages() {
         langSel.value = '';
         changed();
      }

      fromUrl();
      $( 'filters' ).hidden = false;
      $( 'filters' ).addEventListener( 'submit', function ( ev ) { ev.preventDefault(); } );
      langSel.addEventListener( 'change', changed );
      ratingSel.addEventListener( 'change', changed );
      mpBox.addEventListener( 'change', changed );
      qBox.addEventListener( 'input', changed );
      document.addEventListener( 'click', function ( ev ) {
         var t = ev.target;
         if (t.classList && t.classList.contains( 'show-all' )) allLanguages();
      } );
      $( 'clear' ).addEventListener( 'click', function () {
         langSel.value = ''; ratingSel.value = ''; mpBox.checked = false; qBox.value = '';
         changed();
      } );
      apply();
   }

   if (document.querySelector( '.work-page' )) workPage();
   else if ($( 'works' )) frontPage();
})();

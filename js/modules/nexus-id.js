/* ============================================================================
 * PANGEA · js/modules/nexus-id.js
 * NEXUS ID — Identidad descentralizada y soberanía de datos.
 *
 * Principio: tu clave pública ES tu identidad. No hay registro, no hay
 * autoridad, no hay nadie que pueda borrarte. Cada contribución se firma con
 * ECDSA P-256 y cualquiera puede verificarla sin conexión, años después.
 * ==========================================================================*/

import {
  h, icon, scope, clear, fmt, download, readText, readBuffer, uid,
  copyText, zipSync, unzipSync,
} from '../utils.js';
import { Store, COLLECTIONS } from '../store.js';
import { Crypto } from '../crypto.js';

const OWN_COLLECTIONS = ['problems', 'capacities', 'claims', 'knowledge', 'alerts', 'vocab'];

export default {
  id: 'nexus',
  icon: 'id',
  accent: 'indigo',
  titleKey: 'nexus.title',
  subKey: 'nexus.sub',

  async mount(root, ctx) {
    const s = scope(root);
    const view = h('div.view');
    root.append(view);
    let keyRevealed = false;

    const unsubs = [ctx.onStore('identity', () => paint()), ctx.onStore(COLLECTIONS.events, () => paint())];

    async function paint() {
      clear(view);
      const me = await Crypto.current();
      view.append(header(me));
      view.append(me ? await identitySection(me) : await emptyIdentitySection());
      view.append(await reputationSection(me));
      view.append(await contributionsSection(me));
      view.append(passportSection(me));
      view.append(await verificationSection());
      view.append(await privacySection());
      if (me) view.append(await dangerSection(me));
    }

    /* --------------------------------------------------------- Cabecera --- */
    function header(me) {
      return h('div.view-header',
        h('div.view-heading',
          h('h1.view-title', icon('id', 26), ctx.t('nexus.title')),
          h('p.view-sub', { text: ctx.t('nexus.sub') }),
        ),
        h('div.view-actions',
          me ? h('span.badge.ok', icon('lock', 13), me.fingerprint) : h('span.badge.warn', ctx.t('nexus.noIdentity')),
        ),
      );
    }

    /* --------------------------------------------------- Sin identidad ---- */
    async function emptyIdentitySection() {
      const btn = h('button.btn.aurora.lg', {
        onclick: async () => {
          btn.disabled = true;
          clear(btn); btn.append(h('span.spinner.sm'), document.createTextNode(ctx.t('nexus.creating')));
          try {
            const nameInput = view.querySelector('#nexus-name');
            const rec = await Crypto.generate({ name: (nameInput?.value || '').trim() });
            ctx.toast(ctx.t('toast.identityCreated', { fp: rec.fingerprint }), 'ok');
            ctx.state.identity = rec;
          } catch (e) {
            ctx.toast(String(e.message || e), 'err');
            btn.disabled = false;
            clear(btn); btn.append(icon('id', 20), document.createTextNode(ctx.t('nexus.createIdentity')));
          }
        },
      }, icon('id', 20), ctx.t('nexus.createIdentity'));

      return h('div.card.aurora',
        h('div.card-body.stack',
          h('div.row.gap-5.wrap.start',
            h('div.onboard-art', { style: 'width:72px;height:72px;margin:0' }, icon('key', 34)),
            h('div.grow',
              h('h2', { text: ctx.t('nexus.noIdentity') }),
              h('p.sm.dim.mt-2', { text: ctx.t('nexus.noIdentityBody') }),
            ),
          ),
          h('div.field', { style: 'max-width:360px' },
            h('label.label', { for: 'nexus-name' }, ctx.t('nexus.displayName'), h('span.opt', ctx.t('field.optional'))),
            h('input.input', { id: 'nexus-name', placeholder: ctx.t('agente.agentNamePh'), autocomplete: 'nickname' }),
          ),
          h('div.row.gap-2.wrap', btn,
            h('button.btn', { onclick: () => importIdentityDialog() }, icon('upload', 18), ctx.t('nexus.importIdentity')),
          ),
          h('div.banner.ok',
            icon('shield', 20),
            h('div',
              h('strong', { text: ctx.t('nexus.trustTitle') }),
              h('span', { text: ctx.t('nexus.trustBody') }),
            ),
          ),
          h('div.row.gap-2.wrap',
            h('span.badge', icon('key', 12), 'ECDSA P-256'),
            h('span.badge', icon('lock', 12), 'AES-GCM 256'),
            h('span.badge', icon('bolt', 12), 'PBKDF2 · 250 000'),
          ),
        ),
      );
    }

    /* ------------------------------------------------------ Identidad ----- */
    async function identitySection(me) {
      const hue = fmt.hueOf(me.fingerprint);
      const nameInput = h('input.input', {
        value: me.name || '',
        placeholder: ctx.t('nexus.displayName'),
        onchange: async (e) => {
          await Crypto.updateProfile({ name: e.target.value.trim() });
          ctx.toast(ctx.t('toast.saved'), 'ok');
        },
      });

      const keysRow = h('div.row.gap-2.wrap',
        h('button.btn.sm', {
          onclick: async () => { keyRevealed = !keyRevealed; paint(); },
        }, icon(keyRevealed ? 'x' : 'key', 15), keyRevealed ? ctx.t('action.close') : ctx.t('nexus.privateKey')),
        h('button.btn.sm', { onclick: () => copyText(me.pub).then(() => ctx.toast(ctx.t('toast.copied'), 'ok')) }, icon('copy', 15), ctx.t('nexus.publicKey')),
      );

      const box = h('div.stack.sm');
      box.append(h('div.kv', h('dt', { text: ctx.t('nexus.fingerprint') }), h('dd.mono', { text: me.fingerprint })),);
      box.append(h('div.key-box', { text: me.pub }));
      box.append(keysRow);
      if (keyRevealed) {
        box.append(h('div.banner.warn', icon('sos', 20), h('div', h('strong', { text: ctx.t('nexus.privateKeyWarning') }),)));
        box.append(h('div.key-box', { text: me.priv }));
      }

      return h('div.card.mb-4',
        h('div.card-head',
          h('h3', { text: ctx.t('nexus.profile') }),
          h('span.badge.ok', icon('check', 12), ctx.t('state.verified')),
        ),
        h('div.card-body.stack',
          h('div.id-hero',
            h('span.avatar.lg', { style: `background:linear-gradient(135deg, hsl(${hue} 68% 56%), hsl(${(hue + 60) % 360} 68% 48%))`, text: fmt.initials(me.name || me.fingerprint.slice(4, 6)) }),
            h('div.grow',
              h('div.id-fingerprint.aurora-text', { text: me.fingerprint }),
              h('div.tiny.dim.mt-2', { text: `${ctx.t('field.date')}: ${fmt.date(me.createdAt, ctx.I18n.lang)} · ${me.alg}` }),
            ),
            h('button.btn', { onclick: () => signAnything(me) }, icon('shield', 16), ctx.t('nexus.signThis')),
          ),
          h('div.field', { style: 'max-width:380px' }, h('label.label', ctx.t('nexus.displayName')), nameInput),
          box,
        ),
      );
    }

    /* Firma cualquier contenido pegado: demuestra el valor de la identidad. */
    function signAnything(me) {
      const ta = h('textarea.textarea', { placeholder: ctx.t('veritas.claimPh') });
      const out = h('div.stack.sm');
      ctx.openModal({
        title: ctx.t('nexus.signThis'), iconName: 'shield',
        body: h('div.stack', h('p.sm.dim', { text: ctx.t('nexus.trustBody') }), ta, out),
        actions: [
          { label: ctx.t('action.close') },
          {
            label: ctx.t('action.verify'), variant: 'primary',
            onClick: async () => {
              const text = ta.value.trim();
              if (text.length < 4) { ctx.toast(ctx.t('toast.fieldsRequired'), 'warn'); return false; }
              const envelope = await Crypto.signed({ kind: 'pangea.statement', text, at: new Date().toISOString() });
              const ok = await Crypto.verify(envelope);
              clear(out);
              out.append(
                h('div.banner', { class: ok ? 'ok' : 'danger' }, icon(ok ? 'check' : 'sos', 20),
                  h('div', h('strong', { text: ok ? ctx.t('nexus.signatureValid') : ctx.t('nexus.signatureInvalid') }),
                    h('div.tiny.mono', { text: ctx.t('nexus.signedBy', { fp: me.fingerprint }) }))),
                h('div.sig-block', { text: JSON.stringify(envelope, null, 2) }),
                h('button.btn.sm', {
                  onclick: () => copyText(JSON.stringify(envelope)).then(() => ctx.toast(ctx.t('toast.copied'), 'ok')),
                }, icon('copy', 15), ctx.t('action.copy')),
              );
              return false;
            },
          },
        ],
      });
    }

    /* ----------------------------------------------------- Reputación ----- */
    async function reputationSection(me) {
      const points = await ctx.points();
      const events = await Store.query(COLLECTIONS.events, (e) => e.type === 'points');
      const attestations = events.map((e) => e.meta?.attestation).filter(Boolean);

      const body = h('div.card-body.stack');
      body.append(
        h('div.row.gap-6.wrap.baseline',
          h('div',
            h('div.points-big.aurora-text', { text: fmt.num(points, ctx.I18n.lang) }),
            h('div.small.dim', { text: ctx.t('synapse.points') }),
          ),
          h('div.grow',
            h('p.sm.dim', { text: ctx.t('home.pointsBody') }),
          ),
        ),
      );

      if (attestations.length) {
        body.append(h('h4.section-title', { text: ctx.t('nexus.attestations') }));
        body.append(h('div.stack.sm', ...attestations.slice(0, 6).map((att) => h('div.source-item',
          icon('shield', 18),
          h('div.grow',
            h('div.sm', { text: `${att.points > 0 ? '+' : ''}${att.points} · ${att.reason}` }),
            h('div.tiny.mono.dim', { text: `${att.from} → ${att.to} · ${fmt.date(att.issuedAt, ctx.I18n.lang)}` }),
          ),
          h('button.btn.icon.ghost.sm', {
            title: ctx.t('nexus.verifyAttestation'),
            onclick: async () => {
              const v = await Crypto.verifyAttestation(att);
              ctx.openModal({
                title: ctx.t('nexus.verifyAttestation'), iconName: 'shield',
                body: h('div.stack.sm',
                  h('div.banner', { class: v.verdict === 'válida' ? 'ok' : 'danger' },
                    icon(v.verdict === 'válida' ? 'check' : 'sos', 20),
                    h('div', h('strong', { text: v.valid && v.matchesIssuer ? ctx.t('nexus.attestationValid') : ctx.t('nexus.attestationInvalid') }))),
                  h('div.sig-block', { text: JSON.stringify(att, null, 2) }),
                ),
              });
            },
          }, icon('check', 16)),
        ))));
      } else {
        body.append(h('p.hint', { text: ctx.t('nexus.telemetryBody') }));
      }

      return h('div.card.mb-4',
        h('div.card-head', h('h3', { text: ctx.t('synapse.reputation') }),
          h('span.badge.primary', icon('bolt', 12), ctx.t('synapse.points'))),
        body,
      );
    }

    /* ------------------------------------------------ Mis contribuciones -- */
    async function contributionsSection(me) {
      const rows = [];
      for (const c of OWN_COLLECTIONS) {
        const items = await Store.all(c);
        for (const it of items) {
          if (it.seed) continue;
          rows.push({ collection: c, rec: it });
        }
      }
      rows.sort((a, b) => (b.rec.createdAt || 0) - (a.rec.createdAt || 0));

      const list = h('div.list');
      let signedCount = 0;
      for (const { collection, rec } of rows.slice(0, 40)) {
        const v = await ctx.verifyRecord(rec);
        if (v.valid) signedCount++;
        list.append(h('div.list-item',
          h('span.avatar.sm', { style: `background:var(--primary-bg);color:var(--primary)` }, icon(iconForCollection(collection), 15)),
          h('div.grow',
            h('div.sm.truncate', { text: rec.title || rec.text || rec.word || rec.body || rec.id }),
            h('div.tiny.dim', { text: `${ctx.t('nav.' + (collection === 'problems' || collection === 'capacities' ? 'synapse' : collection === 'claims' ? 'veritas' : collection === 'knowledge' ? 'memoria' : collection === 'alerts' ? 'sos' : 'lingua'))} · ${fmt.rel(rec.createdAt, ctx.I18n.lang)}` }),
          ),
          h('span.sig', { class: v.valid ? 'valid' : 'invalid', title: v.label },
            icon(v.valid ? 'check' : 'x', 11), (v.fingerprint || '—').slice(4, 13)),
        ));
      }

      return h('div.card.mb-4',
        h('div.card-head',
          h('h3', { text: ctx.t('nexus.myContributions') }),
          h('span.badge', { class: signedCount === rows.length && rows.length ? 'ok' : '' },
            `${fmt.num(signedCount, ctx.I18n.lang)} / ${fmt.num(rows.length, ctx.I18n.lang)}`),
        ),
        h('div.card-body.flush', rows.length
          ? list
          : h('div.empty', icon('file', 28), h('div.empty-title', { text: ctx.t('state.empty') }), h('div.empty-body', { text: ctx.t('home.noActivity') }))),
      );
    }

    function iconForCollection(c) {
      return { problems: 'flag', capacities: 'handshake', claims: 'shield', knowledge: 'book', alerts: 'sos', vocab: 'translate' }[c] || 'file';
    }

    /* ------------------------------------------------------ Pasaporte ----- */
    async function passportSection(me) {
      const fileInput = h('input', {
        type: 'file', accept: '.json,.zip,.pangea', style: 'display:none',
        onchange: async (e) => {
          const f = e.target.files[0]; if (!f) return;
          try {
            let payload;
            if (/\.(zip|pangea)$/i.test(f.name)) {
              const entries = unzipSync(await readBuffer(f));
              const manifest = entries.find((x) => x.name === 'manifest.json');
              const dataEntry = entries.find((x) => x.name === 'data.json');
              if (!dataEntry) throw new Error('El pasaporte no contiene data.json');
              payload = JSON.parse(dataEntry.text);
              if (manifest) {
                try {
                  const mf = JSON.parse(manifest.text);
                  const ok = await Crypto.verify(mf);
                  ctx.toast(ok ? ctx.t('nexus.signatureValid') : ctx.t('nexus.signatureInvalid'), ok ? 'ok' : 'warn');
                } catch { /* manifiesto ilegible: se ignora */ }
              }
            } else {
              payload = JSON.parse(await readText(f));
            }
            const report = await Store.importAll(payload);
            ctx.toast(ctx.t('nexus.dataImported', { n: report.imported }), 'ok');
            paint();
          } catch (err) { ctx.toast(String(err.message || err), 'err'); }
          e.target.value = '';
        },
      });

      return h('div.card.mb-4',
        h('div.card-head', h('h3', { text: ctx.t('nexus.passport') })),
        h('div.card-body.stack',
          h('p.sm.dim', { text: ctx.t('nexus.passportBody') }),
          h('div.row.gap-2.wrap',
            h('button.btn.primary', {
              onclick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                try {
                  const n = await ctx.downloadPassport();
                  ctx.toast(ctx.t('nexus.dataExported', { n }), 'ok');
                } catch (err) { ctx.toast(String(err.message || err), 'err'); }
                btn.disabled = false;
              },
            }, icon('download', 18), ctx.t('nexus.exportAllData')),
            h('button.btn', { onclick: () => fileInput.click() }, icon('upload', 18), ctx.t('nexus.importAllData')),
            fileInput,
            me ? h('button.btn', { onclick: () => exportIdentityDialog() }, icon('key', 18), ctx.t('nexus.exportIdentity')) : null,
            h('button.btn', { onclick: () => importIdentityDialog() }, icon('upload', 18), ctx.t('nexus.importIdentity')),
          ),
          h('div.row.gap-2.wrap',
            h('span.badge', icon('file', 12), 'PANGEA Passport 1.0'),
            h('span.badge', icon('lock', 12), 'PANGEA-ID-1'),
          ),
          h('p.hint', { text: ctx.t('memoria.storageNote') }),
        ),
      );
    }

    function exportIdentityDialog() {
      const pw = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: ctx.t('nexus.passwordHint') });
      const pw2 = h('input.input', { type: 'password', autocomplete: 'new-password' });
      ctx.openModal({
        title: ctx.t('nexus.exportIdentity'), iconName: 'key', size: 'narrow',
        body: h('div.stack',
          h('div.banner.warn', icon('sos', 20), h('div', h('strong', { text: ctx.t('nexus.privateKeyWarning') }))),
          h('div.field', h('label.label', ctx.t('field.password'), h('span.req', '*')), pw),
          h('div.field', h('label.label', ctx.t('action.confirm')), pw2),
          h('p.hint', { text: ctx.t('nexus.passwordHint') }),
        ),
        actions: [
          { label: ctx.t('action.cancel') },
          {
            label: ctx.t('action.download'), variant: 'primary',
            onClick: async () => {
              if (pw.value.length < 8) { ctx.toast(ctx.t('nexus.passwordHint'), 'warn'); return false; }
              if (pw.value !== pw2.value) { ctx.toast(ctx.t('toast.fieldsRequired'), 'warn'); return false; }
              const bundle = await Crypto.exportIdentity(pw.value);
              download(`pangea-identity-${bundle.fingerprint.replace(/[^A-Z0-9]/g, '')}.json`, JSON.stringify(bundle, null, 2), 'application/json');
              ctx.toast(ctx.t('nexus.identityExported'), 'ok');
            },
          },
        ],
      });
    }

    function importIdentityDialog() {
      const fileInput = h('input', { type: 'file', accept: '.json', style: 'display:none' });
      const pw = h('input.input', { type: 'password', placeholder: ctx.t('field.password') });
      let bundle = null;
      const status = h('div');

      fileInput.addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try {
          bundle = JSON.parse(await readText(f));
          clear(status);
          status.append(h('div.banner.ok', icon('check', 18), h('div.sm.mono', { text: bundle.fingerprint || '—' })));
        } catch (err) { ctx.toast(String(err.message || err), 'err'); }
      });

      ctx.openModal({
        title: ctx.t('nexus.importIdentity'), iconName: 'upload', size: 'narrow',
        body: h('div.stack',
          h('p.sm.dim', { text: ctx.t('app.needIdentity') }),
          h('div.dropzone', { onclick: () => fileInput.click() }, icon('upload', 26), h('div.sm', { text: ctx.t('nexus.importIdentity') })),
          fileInput, status,
          h('div.field', h('label.label', ctx.t('field.password')), pw),
        ),
        actions: [
          { label: ctx.t('action.cancel') },
          {
            label: ctx.t('action.import'), variant: 'primary',
            onClick: async () => {
              if (!bundle) { ctx.toast(ctx.t('toast.fieldsRequired'), 'warn'); return false; }
              try {
                const id = await Crypto.importIdentity(bundle, pw.value);
                ctx.toast(ctx.t('nexus.identityImported', { fp: id.fingerprint }), 'ok');
                ctx.state.identity = id;
                paint();
              } catch (err) { ctx.toast(String(err.message || err), 'err'); return false; }
            },
          },
        ],
      });
    }

    /* --------------------------------------------------- Verificación ----- */
    async function verificationSection() {
      const area = h('textarea.textarea', { placeholder: '{"kind":"pangea.attestation", ..., "sig": {...}}' });
      const out = h('div');

      return h('div.card.mb-4',
        h('div.card-head', h('h3', { text: ctx.t('nexus.verifyAttestation') }), h('span.badge.info', ctx.t('action.verify'))),
        h('div.card-body.stack',
          h('p.sm.dim', { text: ctx.t('nexus.trustBody') }),
          area,
          h('button.btn', {
            onclick: async () => {
              clear(out);
              let parsed;
              try { parsed = JSON.parse(area.value); } catch { ctx.toast(ctx.t('toast.error'), 'err'); return; }
              const verdict = await Crypto.verifyAttestation(parsed);
              out.append(h('div.banner', { class: verdict.valid && verdict.matchesIssuer ? 'ok' : 'danger' },
                icon(verdict.valid && verdict.matchesIssuer ? 'check' : 'sos', 20),
                h('div',
                  h('strong', { text: verdict.valid && verdict.matchesIssuer ? ctx.t('nexus.attestationValid') : ctx.t('nexus.attestationInvalid') }),
                  h('div.tiny.mono', { text: `${verdict.from || '—'} → ${verdict.to || '—'} · ${verdict.points ?? '—'} · ${verdict.verdict}` }),
                )));
            },
          }, icon('shield', 16), ctx.t('action.verify')),
          out,
        ),
      );
    }

    /* ------------------------------------------------------- Privacidad --- */
    async function privacySection() {
      const est = await ctx.U.storageEstimate();
      const tel = await Store.telemetrySummary();
      const totalEvents = tel.reduce((n, r) => n + Object.values(r.counters || {}).reduce((a, b) => a + b, 0), 0);

      return h('div.card.mb-4',
        h('div.card-head', h('h3', { text: ctx.t('nexus.telemetryTitle') }), h('span.badge.ok', icon('lock', 12), ctx.t('settings.privacyTitle'))),
        h('div.card-body.stack',
          h('p.sm.dim', { text: ctx.t('nexus.telemetryBody') }),
          h('div.grid.grid-2',
            h('div.stat', h('span.stat-label', { text: ctx.t('nexus.storage') }),
              h('span.stat-value', { text: est ? fmt.bytes(est.usage) : '—' })),
            h('div.stat', h('span.stat-label', { text: ctx.t('field.notes') }),
              h('span.stat-value', { text: fmt.num(totalEvents, ctx.I18n.lang) })),
          ),
          est ? h('div.progress.storage-bar', h('div.progress-bar', { style: `width:${ctx.U.clamp(est.pct, 2, 100)}%` })) : null,
          h('div.row.gap-2.wrap',
            h('button.btn.sm', { onclick: async () => { await Store.wipeTelemetry(); ctx.toast(ctx.t('toast.deleted'), 'ok'); paint(); } },
              icon('x', 15), ctx.t('nexus.telemetryClear')),
            h('button.btn.sm', { onclick: () => ctx.navigate('settings') }, icon('settings', 15), ctx.t('settings.data')),
          ),
        ),
      );
    }

    /* ------------------------------------------------------ Zona roja ----- */
    async function dangerSection(me) {
      return h('div.danger-zone',
        h('h3', { text: ctx.t('nexus.forget') }),
        h('p.sm.mt-2', { text: ctx.t('nexus.privateKeyWarning') }),
        h('div.row.gap-2.wrap.mt-4',
          h('button.btn.danger', {
            onclick: async () => {
              const ok = await ctx.confirm({ title: ctx.t('nexus.forget'), body: ctx.t('nexus.forgetConfirm'), confirmLabel: ctx.t('action.delete'), danger: true });
              if (!ok) return;
              await Crypto.forget();
              ctx.state.identity = null;
              ctx.toast(ctx.t('toast.deleted'), 'ok');
              paint();
            },
          }, icon('key', 16), ctx.t('nexus.forget')),
        ),
      );
    }

    await paint();

    return () => { unsubs.forEach((u) => { try { u(); } catch {} }); s.destroy(); };
  },
};

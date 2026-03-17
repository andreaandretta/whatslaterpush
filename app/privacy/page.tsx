import type { Metadata } from 'next';
import Link from 'next/link';
import { Calendar, ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Privacy Policy — WhatsLater',
  description: 'Informativa sulla privacy di WhatsLater. Come raccogliamo, utilizziamo e proteggiamo i tuoi dati.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl text-text-primary hover:text-primary transition-colors">
            <Calendar className="w-6 h-6 text-primary" />
            <span>WhatsLater</span>
          </Link>
          <Link href="/" className="flex items-center gap-1 text-sm text-gray-500 hover:text-text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Torna al sito
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-text-primary mb-2">Informativa sulla Privacy</h1>
        <p className="text-gray-500 mb-12">Ultimo aggiornamento: 17 marzo 2026</p>

        <div className="prose prose-gray max-w-none space-y-10 text-[15px] leading-relaxed">

          {/* 1 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">1. Titolare del Trattamento</h2>
            <p>
              Il titolare del trattamento dei dati personali è WhatsLater (di seguito &ldquo;noi&rdquo;, &ldquo;nostro&rdquo; o &ldquo;il Servizio&rdquo;),
              raggiungibile all&apos;indirizzo email: <a href="mailto:privacy@whatslater.com" className="text-primary hover:underline">privacy@whatslater.com</a>.
            </p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">2. Dati Raccolti</h2>
            <p className="mb-4">Raccogliamo esclusivamente i dati strettamente necessari al funzionamento del Servizio:</p>

            <h3 className="text-lg font-semibold text-text-primary mb-2">2.1 Dati forniti direttamente dall&apos;utente</h3>
            <ul className="list-disc pl-6 space-y-1 mb-4">
              <li><strong>Numero di telefono WhatsApp:</strong> utilizzato per identificare l&apos;utente e connettere il proprio account WhatsApp tramite la funzionalit&agrave; &ldquo;Dispositivi collegati&rdquo;.</li>
              <li><strong>Contatti (nome e numero):</strong> i contatti a cui l&apos;utente desidera inviare messaggi programmati, forniti tramite vCard o inserimento manuale.</li>
              <li><strong>Contenuto dei messaggi programmati:</strong> il testo dei messaggi che l&apos;utente desidera programmare per l&apos;invio.</li>
              <li><strong>Date e orari di invio:</strong> la programmazione temporale scelta dall&apos;utente.</li>
            </ul>

            <h3 className="text-lg font-semibold text-text-primary mb-2">2.2 Dati raccolti automaticamente</h3>
            <ul className="list-disc pl-6 space-y-1 mb-4">
              <li><strong>Dati di connessione:</strong> stato della connessione WhatsApp (connesso/disconnesso), timestamp dell&apos;ultima connessione.</li>
              <li><strong>Log di invio:</strong> stato dei messaggi (programmato, inviato, fallito), timestamp di invio, eventuali errori.</li>
              <li><strong>Dati di navigazione:</strong> informazioni tecniche standard (browser, dispositivo) tramite cookie tecnici strettamente necessari.</li>
            </ul>

            <h3 className="text-lg font-semibold text-text-primary mb-2">2.3 Dati NON raccolti</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>Non leggiamo n&eacute; archiviamo i messaggi WhatsApp ricevuti dall&apos;utente (ad eccezione dei messaggi inviati a s&eacute; stessi per la programmazione).</li>
              <li>Non accediamo alla rubrica completa dell&apos;utente.</li>
              <li>Non utilizziamo cookie di profilazione o tracciamento di terze parti.</li>
              <li>Non raccogliamo dati di geolocalizzazione.</li>
            </ul>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">3. Finalit&agrave; e Base Giuridica</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left py-3 pr-4 font-semibold">Finalit&agrave;</th>
                    <th className="text-left py-3 pr-4 font-semibold">Base giuridica</th>
                    <th className="text-left py-3 font-semibold">Conservazione</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr>
                    <td className="py-3 pr-4">Erogazione del servizio di scheduling messaggi</td>
                    <td className="py-3 pr-4">Esecuzione del contratto (Art. 6.1.b GDPR)</td>
                    <td className="py-3">Durata dell&apos;account + 90 giorni</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4">Gestione account e autenticazione</td>
                    <td className="py-3 pr-4">Esecuzione del contratto (Art. 6.1.b GDPR)</td>
                    <td className="py-3">Durata dell&apos;account</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4">Elaborazione pagamenti</td>
                    <td className="py-3 pr-4">Esecuzione del contratto (Art. 6.1.b GDPR)</td>
                    <td className="py-3">Obbligo fiscale (10 anni)</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4">Parsing intelligente dei messaggi (AI)</td>
                    <td className="py-3 pr-4">Esecuzione del contratto (Art. 6.1.b GDPR)</td>
                    <td className="py-3">Tempo reale, non archiviato</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4">Comunicazioni di servizio (notifiche invio, errori)</td>
                    <td className="py-3 pr-4">Legittimo interesse (Art. 6.1.f GDPR)</td>
                    <td className="py-3">90 giorni</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4">Diagnostica e prevenzione abusi</td>
                    <td className="py-3 pr-4">Legittimo interesse (Art. 6.1.f GDPR)</td>
                    <td className="py-3">30 giorni</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">4. Responsabili del Trattamento (Data Processor)</h2>
            <p className="mb-4">Per l&apos;erogazione del Servizio, ci avvaliamo dei seguenti fornitori che agiscono in qualit&agrave; di responsabili del trattamento:</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left py-3 pr-4 font-semibold">Fornitore</th>
                    <th className="text-left py-3 pr-4 font-semibold">Funzione</th>
                    <th className="text-left py-3 pr-4 font-semibold">Localizzazione dati</th>
                    <th className="text-left py-3 font-semibold">DPA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr>
                    <td className="py-3 pr-4 font-medium">Supabase Inc.</td>
                    <td className="py-3 pr-4">Database, autenticazione</td>
                    <td className="py-3 pr-4">EU (eu-west-1, Irlanda)</td>
                    <td className="py-3">Incluso nei ToS</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-medium">Vercel Inc.</td>
                    <td className="py-3 pr-4">Hosting applicazione, edge functions</td>
                    <td className="py-3 pr-4">EU/Global CDN</td>
                    <td className="py-3">Incluso nei ToS</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-medium">Stripe Inc.</td>
                    <td className="py-3 pr-4">Elaborazione pagamenti</td>
                    <td className="py-3 pr-4">EU (Irlanda)</td>
                    <td className="py-3">Incluso nei ToS</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-medium">Groq Inc.</td>
                    <td className="py-3 pr-4">Elaborazione linguaggio naturale (AI)</td>
                    <td className="py-3 pr-4">USA</td>
                    <td className="py-3">SCC in vigore</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-medium">DigitalOcean LLC</td>
                    <td className="py-3 pr-4">Server per connessione WhatsApp</td>
                    <td className="py-3 pr-4">EU</td>
                    <td className="py-3">Incluso nei ToS</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm text-gray-500">
              Per il trasferimento di dati verso gli USA (Groq Inc.), ci basiamo sulle Clausole Contrattuali Standard (SCC) approvate dalla Commissione Europea e/o sull&apos;adeguatezza stabilita dal Data Privacy Framework EU-USA.
            </p>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">5. Connessione WhatsApp e Funzionalit&agrave; &ldquo;Dispositivi Collegati&rdquo;</h2>
            <p className="mb-4">
              WhatsLater si connette al tuo account WhatsApp utilizzando la funzionalit&agrave; nativa &ldquo;Dispositivi collegati&rdquo; di WhatsApp, la stessa tecnologia utilizzata da WhatsApp Web e WhatsApp Desktop.
            </p>
            <ul className="list-disc pl-6 space-y-1 mb-4">
              <li>La connessione avviene tramite scansione di un QR code o inserimento di un codice di accoppiamento, esattamente come per WhatsApp Web.</li>
              <li>WhatsLater opera come un dispositivo collegato al tuo account. Puoi disconnetterlo in qualsiasi momento dalle impostazioni di WhatsApp.</li>
              <li>Non archiviamo le credenziali di accesso al tuo account WhatsApp. La sessione &egrave; gestita da WhatsApp stesso.</li>
              <li>Non abbiamo accesso ai messaggi che ricevi, alle tue chat, ai tuoi gruppi o ai tuoi media, ad eccezione dei messaggi che invii a te stesso per programmare l&apos;invio.</li>
            </ul>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
              <p className="font-semibold text-amber-800 mb-1">Nota importante</p>
              <p className="text-amber-700">
                WhatsLater non &egrave; affiliato, approvato o sponsorizzato da Meta Platforms, Inc. o da WhatsApp LLC. WhatsApp &egrave; un marchio registrato di Meta Platforms, Inc. L&apos;utente utilizza il Servizio sotto la propria responsabilit&agrave; e nel rispetto dei Termini di Servizio di WhatsApp.
              </p>
            </div>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">6. Elaborazione AI dei Messaggi</h2>
            <p className="mb-4">
              Quando scrivi un messaggio a te stesso per programmare un invio, il testo viene elaborato da un modello di intelligenza artificiale (Groq) per estrarre:
            </p>
            <ul className="list-disc pl-6 space-y-1 mb-4">
              <li>Il destinatario del messaggio</li>
              <li>La data e l&apos;ora di invio desiderate</li>
              <li>Il contenuto del messaggio da inviare</li>
            </ul>
            <p>
              Questa elaborazione avviene in tempo reale e il testo <strong>non viene archiviato</strong> da Groq n&eacute; utilizzato per addestrare modelli AI. Il risultato dell&apos;elaborazione (destinatario, orario, messaggio) viene salvato nel nostro database solo per eseguire l&apos;invio programmato.
            </p>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">7. Cookie e Tecnologie di Tracciamento</h2>
            <p className="mb-4">WhatsLater utilizza esclusivamente:</p>
            <ul className="list-disc pl-6 space-y-1 mb-4">
              <li><strong>localStorage del browser:</strong> per mantenere la sessione utente (numero di telefono, nome istanza, scadenza sessione). Dati puramente tecnici, non condivisi con terze parti.</li>
              <li><strong>Cookie tecnici strettamente necessari:</strong> per il funzionamento del sito web.</li>
            </ul>
            <p>
              <strong>Non utilizziamo</strong> cookie di profilazione, Google Analytics, Facebook Pixel, o altri strumenti di tracciamento. Nessun consenso ai cookie &egrave; richiesto in quanto utilizziamo solo cookie tecnici strettamente necessari (Art. 5.3 Direttiva ePrivacy).
            </p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">8. Diritti dell&apos;Interessato</h2>
            <p className="mb-4">Ai sensi degli articoli 15-22 del GDPR, hai il diritto di:</p>
            <ul className="list-disc pl-6 space-y-2 mb-4">
              <li><strong>Accesso</strong> (Art. 15): ottenere una copia dei tuoi dati personali.</li>
              <li><strong>Rettifica</strong> (Art. 16): correggere dati inesatti o incompleti.</li>
              <li><strong>Cancellazione</strong> (Art. 17): richiedere la cancellazione di tutti i tuoi dati (&ldquo;diritto all&apos;oblio&rdquo;).</li>
              <li><strong>Limitazione</strong> (Art. 18): limitare il trattamento in determinate circostanze.</li>
              <li><strong>Portabilit&agrave;</strong> (Art. 20): ricevere i tuoi dati in formato strutturato e leggibile da dispositivo automatico.</li>
              <li><strong>Opposizione</strong> (Art. 21): opporti al trattamento basato su legittimo interesse.</li>
            </ul>
            <p className="mb-4">
              Per esercitare qualsiasi diritto, contattaci a{' '}
              <a href="mailto:privacy@whatslater.com" className="text-primary hover:underline">privacy@whatslater.com</a>.
              Risponderemo entro 30 giorni.
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm">
              <p className="font-semibold text-blue-800 mb-1">Cancellazione completa dei dati</p>
              <p className="text-blue-700">
                Puoi richiedere la cancellazione completa di tutti i tuoi dati (account, messaggi programmati, contatti salvati, log) inviandoci un&apos;email a{' '}
                <a href="mailto:privacy@whatslater.com" className="text-primary hover:underline">privacy@whatslater.com</a>{' '}
                dal numero associato al tuo account. La cancellazione sar&agrave; completata entro 72 ore.
              </p>
            </div>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">9. Sicurezza dei Dati</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Database ospitato su Supabase con crittografia a riposo (AES-256) e in transito (TLS 1.2+).</li>
              <li>Comunicazioni API protette con chiavi segrete e autenticazione token.</li>
              <li>Nessuna password utente archiviata — l&apos;autenticazione avviene tramite WhatsApp.</li>
              <li>Accesso ai dati limitato al solo personale autorizzato.</li>
              <li>Backup giornalieri automatici del database.</li>
            </ul>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">10. Conservazione dei Dati</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Messaggi inviati:</strong> conservati per 90 giorni dopo l&apos;invio, poi cancellati automaticamente.</li>
              <li><strong>Contatti salvati:</strong> conservati per la durata dell&apos;account.</li>
              <li><strong>Log di servizio:</strong> conservati per 30 giorni.</li>
              <li><strong>Dati di fatturazione:</strong> conservati per 10 anni come richiesto dalla normativa fiscale italiana.</li>
              <li><strong>Alla cancellazione dell&apos;account:</strong> tutti i dati personali vengono eliminati entro 72 ore, ad eccezione dei dati di fatturazione soggetti a obbligo di conservazione.</li>
            </ul>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">11. Minori</h2>
            <p>
              WhatsLater non &egrave; destinato a minori di 16 anni. Non raccogliamo consapevolmente dati personali di minori. Se scopriamo di aver raccolto dati di un minore, li cancelleremo immediatamente.
            </p>
          </section>

          {/* 12 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">12. Modifiche alla Privacy Policy</h2>
            <p>
              Ci riserviamo il diritto di aggiornare questa informativa. In caso di modifiche sostanziali, informeremo gli utenti tramite un messaggio WhatsApp o una notifica nel Servizio. La data di ultimo aggiornamento &egrave; sempre indicata in alto.
            </p>
          </section>

          {/* 13 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">13. Reclami</h2>
            <p>
              Se ritieni che il trattamento dei tuoi dati violi il GDPR, hai il diritto di proporre reclamo al{' '}
              <strong>Garante per la protezione dei dati personali</strong> (
              <a href="https://www.garanteprivacy.it" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">www.garanteprivacy.it</a>
              ), Piazza Venezia 11, 00187 Roma.
            </p>
          </section>

          {/* 14 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">14. Contatti</h2>
            <p>
              Per qualsiasi domanda relativa alla privacy, contattaci a:{' '}
              <a href="mailto:privacy@whatslater.com" className="text-primary hover:underline">privacy@whatslater.com</a>
            </p>
          </section>

        </div>

        {/* Footer links */}
        <div className="mt-16 pt-8 border-t border-gray-200 flex flex-wrap gap-6 text-sm text-gray-500">
          <Link href="/terms" className="hover:text-primary transition-colors">Termini di Servizio</Link>
          <Link href="/" className="hover:text-primary transition-colors">Torna alla Home</Link>
        </div>
      </main>
    </div>
  );
}

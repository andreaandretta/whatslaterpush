import type { Metadata } from 'next';
import Link from 'next/link';
import { Calendar, ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Termini di Servizio — WhatsLater',
  description: 'Termini e condizioni di utilizzo del servizio WhatsLater per la programmazione di messaggi WhatsApp.',
};

export default function TermsPage() {
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
        <h1 className="text-4xl font-bold text-text-primary mb-2">Termini di Servizio</h1>
        <p className="text-gray-500 mb-12">Ultimo aggiornamento: 17 marzo 2026</p>

        <div className="prose prose-gray max-w-none space-y-10 text-[15px] leading-relaxed">

          {/* 1 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">1. Accettazione dei Termini</h2>
            <p>
              Utilizzando WhatsLater (di seguito &ldquo;il Servizio&rdquo;), accetti integralmente i presenti Termini di Servizio. Se non accetti questi termini, non utilizzare il Servizio. L&apos;utilizzo del Servizio costituisce accettazione vincolante di questi termini.
            </p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">2. Descrizione del Servizio</h2>
            <p className="mb-4">
              WhatsLater &egrave; un servizio che permette di programmare l&apos;invio di messaggi WhatsApp dal proprio numero personale. Il Servizio funziona tramite la funzionalit&agrave; nativa &ldquo;Dispositivi collegati&rdquo; di WhatsApp.
            </p>
            <p>Il Servizio include:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Programmazione di messaggi WhatsApp per invio futuro</li>
              <li>Parsing intelligente del linguaggio naturale per estrarre destinatario, data/ora e contenuto</li>
              <li>Gestione dei contatti per l&apos;invio programmato</li>
              <li>Dashboard per monitorare lo stato dei messaggi</li>
            </ul>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">3. Connessione WhatsApp</h2>
            <h3 className="text-lg font-semibold text-text-primary mb-2">3.1 Modalit&agrave; di connessione</h3>
            <p className="mb-4">
              Per utilizzare il Servizio, l&apos;utente deve connettere il proprio account WhatsApp tramite scansione di QR code o codice di accoppiamento, utilizzando la funzionalit&agrave; &ldquo;Dispositivi collegati&rdquo; di WhatsApp.
            </p>

            <h3 className="text-lg font-semibold text-text-primary mb-2">3.2 Disclaimer Meta/WhatsApp</h3>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm mb-4">
              <p className="font-semibold text-amber-800 mb-2">Dichiarazione importante</p>
              <ul className="list-disc pl-5 space-y-1 text-amber-700">
                <li>WhatsLater <strong>non &egrave; affiliato, approvato, sponsorizzato o associato</strong> a Meta Platforms, Inc., WhatsApp LLC o qualsiasi loro sussidiaria.</li>
                <li>WhatsApp&reg; &egrave; un marchio registrato di Meta Platforms, Inc.</li>
                <li>Il Servizio si connette tramite la funzionalit&agrave; &ldquo;Dispositivi collegati&rdquo; gi&agrave; presente in WhatsApp.</li>
                <li>L&apos;utilizzo del Servizio &egrave; sotto la <strong>piena responsabilit&agrave; dell&apos;utente</strong> e nel rispetto dei Termini di Servizio di WhatsApp.</li>
              </ul>
            </div>

            <h3 className="text-lg font-semibold text-text-primary mb-2">3.3 Rischio restrizioni WhatsApp</h3>
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm">
              <p className="font-semibold text-red-800 mb-2">Avvertenza</p>
              <p className="text-red-700 mb-2">
                L&apos;invio di un numero elevato di messaggi o l&apos;utilizzo non conforme ai Termini di Servizio di WhatsApp pu&ograve; comportare <strong>restrizioni temporanee o permanenti</strong> sul proprio numero WhatsApp da parte di Meta/WhatsApp.
              </p>
              <p className="text-red-700">
                WhatsLater implementa misure di protezione (rate limiting, cool-down) per minimizzare questo rischio, ma <strong>non pu&ograve; garantire</strong> che l&apos;utilizzo del Servizio non comporti restrizioni da parte di WhatsApp. L&apos;utente utilizza il Servizio a proprio rischio e pericolo.
              </p>
            </div>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">4. Piani e Prezzi</h2>
            <h3 className="text-lg font-semibold text-text-primary mb-2">4.1 Piani disponibili</h3>
            <div className="overflow-x-auto mb-4">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left py-3 pr-4 font-semibold">Caratteristica</th>
                    <th className="text-left py-3 pr-4 font-semibold">Free</th>
                    <th className="text-left py-3 pr-4 font-semibold">Personal (&euro;4,99/mese)</th>
                    <th className="text-left py-3 font-semibold">Business (&euro;19,99/mese)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr>
                    <td className="py-3 pr-4">Messaggi al giorno</td>
                    <td className="py-3 pr-4">3</td>
                    <td className="py-3 pr-4">20</td>
                    <td className="py-3">50</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4">Contatti salvati</td>
                    <td className="py-3 pr-4">5</td>
                    <td className="py-3 pr-4">50</td>
                    <td className="py-3">Illimitati</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4">AI parsing</td>
                    <td className="py-3 pr-4">Incluso</td>
                    <td className="py-3 pr-4">Incluso</td>
                    <td className="py-3">Incluso + rewrite</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4">Storico messaggi</td>
                    <td className="py-3 pr-4">7 giorni</td>
                    <td className="py-3 pr-4">30 giorni</td>
                    <td className="py-3">90 giorni + export</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="text-lg font-semibold text-text-primary mb-2">4.2 Trial gratuito</h3>
            <p className="mb-2">
              I nuovi utenti ricevono un periodo di prova gratuito di 7 giorni con funzionalit&agrave; del piano Personal. Al termine del trial:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>L&apos;utente passa automaticamente al piano Free (3 messaggi/giorno).</li>
              <li>I messaggi programmati oltre il limite giornaliero vengono messi in pausa, non cancellati.</li>
              <li>Nessun addebito automatico — il pagamento &egrave; sempre una scelta esplicita dell&apos;utente.</li>
            </ul>

            <h3 className="text-lg font-semibold text-text-primary mt-4 mb-2">4.3 Pagamenti e rimborsi</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>I pagamenti sono gestiti da <strong>Stripe</strong>. WhatsLater non archivia n&eacute; ha accesso ai dati della tua carta di credito.</li>
              <li>Gli abbonamenti si rinnovano automaticamente ogni mese. Puoi cancellarli in qualsiasi momento.</li>
              <li>La cancellazione ha effetto alla fine del periodo di fatturazione corrente.</li>
              <li>Non sono previsti rimborsi per periodi parziali, salvo quanto previsto dalla normativa vigente.</li>
            </ul>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">5. Obblighi e Responsabilit&agrave; dell&apos;Utente</h2>
            <h3 className="text-lg font-semibold text-text-primary mb-2">5.1 Utilizzo consentito</h3>
            <p className="mb-2">L&apos;utente si impegna a:</p>
            <ul className="list-disc pl-6 space-y-1 mb-4">
              <li>Utilizzare il Servizio solo per inviare messaggi a persone che hanno fornito il proprio consenso a ricevere comunicazioni.</li>
              <li>Rispettare i Termini di Servizio di WhatsApp.</li>
              <li>Non superare i limiti del proprio piano di abbonamento.</li>
              <li>Fornire informazioni accurate e aggiornate.</li>
            </ul>

            <h3 className="text-lg font-semibold text-text-primary mb-2">5.2 Utilizzo vietato</h3>
            <p className="mb-2">&Egrave; severamente vietato utilizzare il Servizio per:</p>
            <ul className="list-disc pl-6 space-y-1 mb-4">
              <li><strong>Spam:</strong> invio massivo di messaggi non richiesti o commerciali non autorizzati.</li>
              <li><strong>Contenuti illegali:</strong> diffusione di materiale illegale, diffamatorio, minaccioso, osceno o che viola i diritti di terzi.</li>
              <li><strong>Phishing o truffe:</strong> tentativi di frode, furto di identit&agrave; o ingegneria sociale.</li>
              <li><strong>Molestie:</strong> invio ripetuto di messaggi a persone che hanno chiesto di non essere contattate.</li>
              <li><strong>Elusione dei limiti:</strong> creazione di account multipli o tentativi di aggirare i limiti del piano.</li>
              <li><strong>Reverse engineering:</strong> tentativi di decompilare, disassemblare o derivare il codice sorgente del Servizio.</li>
            </ul>

            <h3 className="text-lg font-semibold text-text-primary mb-2">5.3 Contenuto dei messaggi</h3>
            <p>
              L&apos;utente &egrave; l&apos;unico responsabile del contenuto dei messaggi programmati tramite il Servizio. WhatsLater non monitora, approva n&eacute; censura il contenuto dei messaggi, ma si riserva il diritto di sospendere account che violano questi termini.
            </p>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">6. Limiti di Utilizzo e Protezione Anti-Ban</h2>
            <p className="mb-4">Per proteggere gli utenti dal rischio di restrizioni WhatsApp, il Servizio applica automaticamente:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Limite giornaliero</strong> per piano: Free (3), Personal (20), Business (50) messaggi al giorno.</li>
              <li><strong>Cool-down per destinatario:</strong> massimo 3 messaggi allo stesso numero nelle 24 ore.</li>
              <li><strong>Rate limiting:</strong> massimo 15 messaggi al minuto. Oltre 10 messaggi in 10 minuti, rallentamento a 1 messaggio al minuto.</li>
              <li><strong>Avviso automatico:</strong> all&apos;80% del limite giornaliero, l&apos;utente riceve un avviso.</li>
              <li><strong>Solo contatti noti:</strong> i messaggi possono essere inviati solo a contatti salvati (nessun invio a numeri sconosciuti).</li>
            </ul>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">7. Disponibilit&agrave; del Servizio</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>WhatsLater si impegna a fornire il Servizio con la massima affidabilit&agrave; possibile, ma <strong>non garantisce un uptime del 100%</strong>.</li>
              <li>Il Servizio pu&ograve; subire interruzioni per manutenzione, aggiornamenti o cause di forza maggiore.</li>
              <li>In caso di indisponibilit&agrave; prolungata (superiore a 48 ore consecutive), gli utenti con piano a pagamento potranno richiedere un&apos;estensione proporzionale del proprio abbonamento.</li>
              <li>WhatsLater non &egrave; responsabile per la mancata consegna di messaggi dovuta a problemi di WhatsApp, connessione dell&apos;utente o indisponibilit&agrave; del destinatario.</li>
            </ul>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">8. Limitazione di Responsabilit&agrave;</h2>
            <p className="mb-4">Nella misura massima consentita dalla legge:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                WhatsLater <strong>non &egrave; responsabile</strong> per eventuali restrizioni, sospensioni o ban del numero WhatsApp dell&apos;utente da parte di Meta/WhatsApp derivanti dall&apos;utilizzo del Servizio.
              </li>
              <li>
                WhatsLater <strong>non &egrave; responsabile</strong> per danni diretti, indiretti, incidentali, speciali o consequenziali derivanti dall&apos;utilizzo o dall&apos;impossibilit&agrave; di utilizzare il Servizio.
              </li>
              <li>
                La responsabilit&agrave; complessiva di WhatsLater nei confronti dell&apos;utente non potr&agrave; in ogni caso superare l&apos;importo pagato dall&apos;utente nei 12 mesi precedenti l&apos;evento.
              </li>
              <li>
                Le presenti limitazioni si applicano nella misura consentita dal Codice del Consumo italiano (D.Lgs. 206/2005) e non escludono n&eacute; limitano la responsabilit&agrave; per dolo o colpa grave.
              </li>
            </ul>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">9. Sospensione e Chiusura Account</h2>
            <h3 className="text-lg font-semibold text-text-primary mb-2">9.1 Da parte di WhatsLater</h3>
            <p className="mb-2">Ci riserviamo il diritto di sospendere o chiudere un account in caso di:</p>
            <ul className="list-disc pl-6 space-y-1 mb-4">
              <li>Violazione dei presenti Termini di Servizio.</li>
              <li>Utilizzo del Servizio per spam, molestie o attivit&agrave; illegali.</li>
              <li>Tentativi di elusione dei limiti del piano.</li>
              <li>Mancato pagamento per piani a pagamento.</li>
            </ul>
            <p className="mb-4">In caso di sospensione per violazione, non &egrave; previsto alcun rimborso.</p>

            <h3 className="text-lg font-semibold text-text-primary mb-2">9.2 Da parte dell&apos;utente</h3>
            <p>
              L&apos;utente pu&ograve; cancellare il proprio account in qualsiasi momento disconnettendo WhatsApp dal Servizio e richiedendo la cancellazione dei dati a{' '}
              <a href="mailto:privacy@whatslater.com" className="text-primary hover:underline">privacy@whatslater.com</a>.
              Tutti i dati saranno cancellati entro 72 ore dalla richiesta, ad eccezione dei dati soggetti a obbligo di conservazione legale.
            </p>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">10. Propriet&agrave; Intellettuale</h2>
            <p>
              Tutti i diritti di propriet&agrave; intellettuale relativi al Servizio (software, design, marchi, contenuti) appartengono a WhatsLater. L&apos;utente riceve una licenza limitata, non esclusiva, non trasferibile e revocabile per utilizzare il Servizio conformemente ai presenti termini.
            </p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">11. Modifiche ai Termini</h2>
            <p>
              Ci riserviamo il diritto di modificare i presenti Termini in qualsiasi momento. Le modifiche sostanziali saranno comunicate con almeno 15 giorni di preavviso tramite il Servizio o via WhatsApp. L&apos;utilizzo continuato del Servizio dopo le modifiche costituisce accettazione dei nuovi termini.
            </p>
          </section>

          {/* 12 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">12. Legge Applicabile e Foro Competente</h2>
            <p className="mb-2">
              I presenti Termini sono regolati dalla legge italiana. Per qualsiasi controversia derivante da o relativa ai presenti Termini:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Per i consumatori (ai sensi del Codice del Consumo): &egrave; competente il foro del luogo di residenza o domicilio del consumatore, se in Italia.</li>
              <li>Per gli utenti professionisti: &egrave; competente in via esclusiva il Foro di Milano.</li>
              <li>&Egrave; sempre possibile ricorrere alla piattaforma ODR della Commissione Europea:{' '}
                <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  ec.europa.eu/consumers/odr
                </a>
              </li>
            </ul>
          </section>

          {/* 13 */}
          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">13. Contatti</h2>
            <p>
              Per qualsiasi domanda relativa ai presenti Termini, contattaci a:{' '}
              <a href="mailto:info@whatslater.com" className="text-primary hover:underline">info@whatslater.com</a>
            </p>
          </section>

        </div>

        {/* Footer links */}
        <div className="mt-16 pt-8 border-t border-gray-200 flex flex-wrap gap-6 text-sm text-gray-500">
          <Link href="/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link>
          <Link href="/" className="hover:text-primary transition-colors">Torna alla Home</Link>
        </div>
      </main>
    </div>
  );
}

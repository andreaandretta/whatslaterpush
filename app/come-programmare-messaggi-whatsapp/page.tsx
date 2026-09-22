import type { Metadata } from 'next';
import Link from 'next/link';
import GuideLayout, { GuideCta } from '../components/GuideLayout';
import { guideByPath, siteUrl, type FaqItem } from '../lib/site';

const page = guideByPath('/come-programmare-messaggi-whatsapp');

export const metadata: Metadata = {
  title: `${page.title} — WhatsLater`,
  description: page.description,
  alternates: { canonical: `${siteUrl()}${page.path}` },
  openGraph: { title: page.title, description: page.description, type: 'article', locale: 'it_IT' },
};

const faqs: FaqItem[] = [
  {
    q: 'WhatsApp permette di programmare un messaggio?',
    a: 'Nell\'app normale oggi no. Meta sta provando una funzione di programmazione nelle versioni di test: dalle prime prove serve per un singolo messaggio, dentro una chat, con un anticipo minimo di pochi minuti e un massimo di circa due settimane, senza ripetizioni. Quando arriverà, coprirà il "ricordati domani"; non le cose che si ripetono ogni settimana.',
  },
  {
    q: 'Con WhatsApp Business posso programmare i messaggi?',
    a: 'WhatsApp Business ha i messaggi di assenza e di benvenuto: partono da soli quando qualcuno ti scrive, non a un\'ora scelta da te. Non è una programmazione. Per mandare un promemoria a un orario preciso, anche da un numero Business, serve un servizio esterno.',
  },
  {
    q: 'Su iPhone posso usare i Comandi rapidi?',
    a: 'Sì, con un\'automazione che all\'ora scelta apre WhatsApp con il testo pronto: ma devi confermare tu con un tocco, e il telefono deve essere acceso e sbloccato. Va bene per un messaggio ogni tanto, non per decine di promemoria a settimana.',
  },
  {
    q: 'Le app Android che programmano WhatsApp funzionano?',
    a: 'Quelle che usano i "servizi di accessibilità" simulano i tocchi sul tuo telefono: devono trovarlo acceso, sbloccato e con WhatsApp aperto in quel momento. Se lo stai usando, o è in tasca, l\'invio salta. Chiedono inoltre permessi molto ampi sul telefono.',
  },
  {
    q: 'Come faccio un messaggio ricorrente, per esempio ogni lunedì alle 7?',
    a: 'In WhatsLater programmi il primo lunedì alle 7 e tocchi "Ripeti → ogni settimana". Le occorrenze successive si creano da sole, e l\'orario resta quello italiano anche al cambio dell\'ora. Ogni occorrenza si può modificare, mettere in pausa o cancellare prima che parta.',
  },
  {
    q: 'Il messaggio parte anche se il telefono è spento?',
    a: 'Sì. WhatsLater usa il collegamento "Dispositivi collegati" di WhatsApp, come WhatsApp Web: il messaggio esce da un server collegato al tuo numero, non dal telefono. Serve solo che il collegamento resti attivo; se cade, te lo segnaliamo nell\'app.',
  },
];

export default function Page() {
  return (
    <GuideLayout
      title={page.title}
      lead="Programmare un messaggio WhatsApp vuol dire scriverlo oggi e farlo partire a un'ora scelta. Ecco le strade che esistono davvero, con i limiti di ciascuna, e come fare quando il messaggio deve ripetersi ogni settimana."
      updated={page.updated}
      faqs={faqs}
    >
      <section>
        <h2 className="text-2xl font-bold mb-4">Le strade che esistono oggi</h2>
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-[#E9EDEF] p-5">
            <h3 className="font-semibold text-lg mb-1">1. WhatsApp da solo</h3>
            <p className="text-text-secondary">
              L&apos;app normale non ha una funzione per programmare. Una programmazione &ldquo;nativa&rdquo; è in prova nelle versioni beta: un messaggio alla volta, dentro una chat, con un anticipo massimo di circa due settimane e senza ripetizioni. Quando uscirà, sarà comoda per il singolo &ldquo;ricordati domani&rdquo;.
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-[#E9EDEF] p-5">
            <h3 className="font-semibold text-lg mb-1">2. WhatsApp Business</h3>
            <p className="text-text-secondary">
              Ha i messaggi di assenza e di benvenuto, che rispondono da soli a chi ti scrive. Non parte niente a un orario deciso da te. È utile per dire &ldquo;siamo chiusi, rispondiamo domani&rdquo;, non per ricordare la lezione di giovedì.
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-[#E9EDEF] p-5">
            <h3 className="font-semibold text-lg mb-1">3. iPhone: Comandi rapidi</h3>
            <p className="text-text-secondary">
              Un&apos;automazione può aprire WhatsApp all&apos;ora scelta con il testo già scritto. Il tocco finale però lo dai tu, con il telefono in mano e sbloccato. Un messaggio ogni tanto sì; venti promemoria a settimana no.
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-[#E9EDEF] p-5">
            <h3 className="font-semibold text-lg mb-1">4. Android: app che &ldquo;toccano&rdquo; il telefono per te</h3>
            <p className="text-text-secondary">
              Usano i servizi di accessibilità per simulare i tocchi. Funzionano solo se il telefono è acceso, sbloccato e libero in quel momento, e chiedono permessi molto ampi. Se stai usando il telefono, l&apos;invio salta.
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-[#E9EDEF] p-5">
            <h3 className="font-semibold text-lg mb-1">5. Un servizio collegato al tuo numero (WhatsLater)</h3>
            <p className="text-text-secondary">
              Colleghi il tuo WhatsApp una volta, come per WhatsApp Web. Da lì programmi i messaggi da una coda sola, con la ripetizione che vuoi, e partono da soli dal tuo numero anche col telefono spento. È la strada per chi manda gli stessi promemoria ogni settimana a più persone.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-4">Messaggi ricorrenti: come si fanno</h2>
        <ol className="list-decimal pl-6 space-y-3">
          <li><strong>Scegli il contatto</strong> tra quelli con cui hai già una chat. Puoi aggiungere un numero a mano, ma i primi messaggi a chi non ti conosce partono piano, di proposito.</li>
          <li><strong>Scrivi il testo</strong>, anche con il segnaposto <code className="bg-[#F0F2F5] px-1 rounded">{'{nome}'}</code>, che viene sostituito al momento dell&apos;invio.</li>
          <li><strong>Scegli giorno e ora</strong>, poi tocca &ldquo;Ripeti&rdquo;: ogni giorno, ogni settimana o ogni mese. Il bottone ti ripete l&apos;orario in parole prima di confermare.</li>
          <li><strong>Chiudi tutto.</strong> Ogni occorrenza compare nella coda: la puoi modificare, mettere in pausa, spostare di un&apos;ora o a domani, o cancellare.</li>
        </ol>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-4">Quello che è giusto sapere prima</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>Il collegamento è quello di &ldquo;Dispositivi collegati&rdquo;, come WhatsApp Web: non è l&apos;API ufficiale di Meta e WhatsLater non è un servizio di Meta. Il rischio che WhatsApp limiti il numero non è azzerabile. Per questo il prodotto applica da solo regole di cortesia (orari umani, poco volume, solo a chi ti conosce). Le trovi in <Link href="/come-proteggiamo-il-tuo-numero" className="text-primary hover:underline">Come proteggiamo il tuo numero</Link>.</li>
          <li>Non scriviamo mai a liste di numeri sconosciuti e non c&apos;è nessuna funzione di invio massivo. Se cerchi quello, questo non è il prodotto giusto.</li>
          <li>Il piano gratuito è permanente: 3 messaggi al giorno. Durante la beta è tutto gratis, senza carta.</li>
        </ul>
      </section>

      <GuideCta note="Colleghi il numero in 2 minuti · Niente carta" />
    </GuideLayout>
  );
}

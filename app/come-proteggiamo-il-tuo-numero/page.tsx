import type { Metadata } from 'next';
import Link from 'next/link';
import GuideLayout, { GuideCta } from '../components/GuideLayout';
import { guideByPath, siteUrl, type FaqItem } from '../lib/site';

const page = guideByPath('/come-proteggiamo-il-tuo-numero');

export const metadata: Metadata = {
  title: `${page.title} — WhatsLater`,
  description: page.description,
  alternates: { canonical: `${siteUrl()}${page.path}` },
  openGraph: { title: page.title, description: page.description, type: 'article', locale: 'it_IT' },
};

const faqs: FaqItem[] = [
  {
    q: 'Posso essere bloccato da WhatsApp usando WhatsLater?',
    a: 'Nessuno può escluderlo, e diffida di chi lo promette. WhatsApp limita soprattutto chi scrive a persone che non lo conoscono o che lo segnalano. WhatsLater è costruito per tenerti lontano da lì: scrive ai tuoi contatti, poco, in orari umani, e ti frena da solo prima che tu esageri.',
  },
  {
    q: 'Perché ai numeri nuovi scrivete così piano?',
    a: 'Perché il primo messaggio a chi non ti ha mai scritto è il segnale che WhatsApp guarda di più. Ai numeri che non sono tra i tuoi contatti e non hanno mai ricevuto niente da te, il prodotto manda pochi messaggi al giorno e sposta il resto al mattino dopo.',
  },
  {
    q: 'Cosa vuol dire "inviato" nella coda?',
    a: 'Che il messaggio è stato consegnato a WhatsApp dal nostro server, come quando premi invio su WhatsApp Web. Quando WhatsApp ci comunica la consegna e la lettura, accanto al messaggio compaiono le spunte, come nell\'app. La conferma che WhatsApp ha preso in carico il messaggio è ancora in lavorazione.',
  },
  {
    q: 'Cosa succede se il collegamento cade?',
    a: 'Capita, per esempio quando WhatsApp aggiorna il suo protocollo o quando scolleghi il dispositivo dal telefono. I messaggi in coda non si perdono: vengono rimandati al giorno dopo e nell\'app compare l\'avviso per ricollegare il numero.',
  },
  {
    q: 'Leggete le mie chat?',
    a: 'No, non leggiamo i messaggi delle tue chat. Per farti scegliere i destinatari sincronizziamo i contatti del tuo WhatsApp (nome, numero e foto del profilo). Dei promemoria vediamo il testo che hai programmato, il destinatario e l\'orario: sono cifrati a riposo su server nell\'Unione Europea e vengono cancellati quando elimini l\'account.',
  },
  {
    q: 'Posso usare un numero diverso da quello personale?',
    a: 'Sì. Puoi collegare il tuo WhatsApp Business, una seconda SIM o un numero fisso. Il consiglio è collegare il numero che i tuoi clienti conoscono già, perché è quello a cui rispondono.',
  },
];

export default function Page() {
  return (
    <GuideLayout
      title={page.title}
      lead="WhatsLater manda i promemoria dal tuo numero. È il motivo per cui i clienti rispondono, ed è anche il motivo per cui prendiamo sul serio il modo in cui li mandiamo. Qui c'è scritto tutto: le regole, i limiti, e cosa può andare storto."
      updated={page.updated}
      faqs={faqs}
    >
      <section>
        <h2 className="text-2xl font-bold mb-4">Le regole che il prodotto applica da solo</h2>
        <ul className="space-y-4">
          <li className="bg-white rounded-2xl border border-[#E9EDEF] p-5">
            <strong>Solo a chi ti conosce.</strong> Il prodotto è fatto per i tuoi contatti: chi ti ha già scritto o è nella tua rubrica. Ai numeri nuovi scrive pochissimo al giorno e sposta il resto al mattino dopo. Non esiste una funzione di invio massivo, né ci sarà.
          </li>
          <li className="bg-white rounded-2xl border border-[#E9EDEF] p-5">
            <strong>Orari umani.</strong> Quando è il prodotto a rimandare un messaggio, perché hai raggiunto il limite del giorno o perché il destinatario è un numero nuovo, lo sposta al mattino dopo, dalle 8 in poi. L&apos;orario scelto da te a mano non viene mai toccato.
          </li>
          <li className="bg-white rounded-2xl border border-[#E9EDEF] p-5">
            <strong>Poco volume, e si parte piano.</strong> Ogni piano ha un tetto giornaliero basso (il gratuito 3, i piani a pagamento tra 20 e 50). Un numero appena collegato parte con un tetto ancora più basso che cresce nei primi giorni.
          </li>
          <li className="bg-white rounded-2xl border border-[#E9EDEF] p-5">
            <strong>Niente firma pubblicitaria.</strong> Nei messaggi che partono dal tuo numero non c&apos;è mai &ldquo;inviato con WhatsLater&rdquo; né altro. Sono i tuoi messaggi.
          </li>
          <li className="bg-white rounded-2xl border border-[#E9EDEF] p-5">
            <strong>Nessuna notifica inutile a te.</strong> Il prodotto avvisa i tuoi clienti, non te. Ti scriviamo solo se qualcosa si rompe o se sta per scadere qualcosa.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-4">Cosa non facciamo mai</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>Non facciamo invii massivi: niente liste broadcast, niente campagne. Ai numeri che non ti conoscono il prodotto scrive al massimo pochi messaggi al giorno, e ti sconsigliamo di farlo.</li>
          <li>Non mandiamo pubblicità, né nostra né di altri, dal tuo numero.</li>
          <li>Non leggiamo le tue chat e non analizziamo il contenuto dei messaggi.</li>
          <li>Non promettiamo &ldquo;zero rischio&rdquo;: chi lo fa, o non usa il tuo numero, o non te lo sta dicendo.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-4">Cosa può rompersi, e cosa succede</h2>
        <div className="space-y-4">
          <p>
            <strong>Il collegamento cade.</strong> WhatsApp ogni tanto cambia il modo in cui parla con i dispositivi collegati, oppure scolleghi tu il dispositivo dal telefono. In quel caso nessun messaggio parte: la coda si ferma, i promemoria vengono rimandati al giorno dopo e nell&apos;app compare l&apos;avviso per ricollegare il numero con un nuovo codice.
          </p>
          <p>
            <strong>WhatsApp limita il numero.</strong> Può succedere a chiunque mandi messaggi in modo automatico, anche con le regole sopra: il rischio non è zero. Se gli invii iniziano a fallire, il prodotto si ferma da solo dopo pochi errori invece di insistere. Se vuoi separare del tutto i promemoria dalla tua vita su WhatsApp, collega un secondo numero o il tuo WhatsApp Business: il prodotto funziona allo stesso modo.
          </p>
          <p>
            <strong>&ldquo;Inviato&rdquo; non è ancora &ldquo;consegnato&rdquo;.</strong> Oggi &ldquo;inviato&rdquo; vuol dire che il messaggio è stato passato a WhatsApp dal nostro server, come quando premi invio su WhatsApp Web. Quando WhatsApp ci comunica la consegna e la lettura, accanto al messaggio compaiono le spunte. La conferma che WhatsApp ha preso in carico il messaggio è ancora in lavorazione. Lo scriviamo qui perché è una differenza che conta.
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-4">Dove stanno i tuoi dati</h2>
        <p>
          Il server che tiene il collegamento con WhatsApp è in Germania; i dati dell&apos;app sono nell&apos;Unione Europea. I messaggi programmati sono cifrati a riposo. Nell&apos;app li vedi per il periodo di storico del piano; vengono cancellati del tutto quando elimini l&apos;account. I dettagli sono nella{' '}
          <Link href="/privacy" className="text-primary hover:underline">Privacy</Link> e nei{' '}
          <Link href="/terms" className="text-primary hover:underline">Termini</Link>.
        </p>
      </section>

      <GuideCta note="Colleghi il numero in 2 minuti · Lo scolleghi quando vuoi dal telefono" />
    </GuideLayout>
  );
}

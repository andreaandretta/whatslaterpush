export default function StatsBar() {
  const stats = [
    { number: '2', label: 'minuti per iniziare' },
    { number: '0', label: 'app da installare' },
    { number: '100%', label: 'dal tuo numero WhatsApp' },
  ];

  return (
    <section className="bg-text-primary py-10">
      <div className="max-w-4xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-8">
        {stats.map((stat, i) => (
          <div
            key={i}
            className={`flex-1 text-center ${
              i < stats.length - 1 ? 'sm:border-r sm:border-white/20' : ''
            }`}
          >
            <div className="text-3xl font-bold text-white">{stat.number}</div>
            <div className="text-sm text-white/70 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

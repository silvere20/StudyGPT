/**
 * SkeletonLoader — toont een geanimeerde preview van de resultatenkaarten
 * terwijl documenten worden verwerkt. De structuur bootst de echte
 * ResultsSection na: een stats-balk, een onderwerpssidebar en hoofdstukkaarten.
 */
export function SkeletonLoader() {
  return (
    <div className="space-y-8 opacity-60 pointer-events-none select-none mt-10">
      {/* Stats balk */}
      <div className="flex items-center gap-4 flex-wrap">
        {[80, 96, 120, 104].map((w, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gray-200 rounded animate-pulse" />
            <div className={`h-3.5 bg-gray-200 rounded animate-pulse`} style={{ width: w }} />
            {i < 3 && <div className="w-1 h-1 bg-gray-200 rounded-full ml-2" />}
          </div>
        ))}
      </div>

      {/* Grid: sidebar + hoofdstukken */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sidebar */}
        <div className="lg:col-span-4 space-y-3">
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between mb-1">
            <div className="h-3 w-24 bg-gray-200 rounded animate-pulse" />
            <div className="w-5 h-5 bg-gray-200 rounded animate-pulse" />
          </div>
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ width: `${55 + i * 12}%` }} />
                <div className="h-6 w-8 bg-gray-200 rounded-md animate-pulse" />
              </div>
              {[1, 2].map(j => (
                <div key={j} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-gray-200 rounded-full animate-pulse shrink-0" />
                  <div className="h-2.5 bg-gray-200 rounded animate-pulse" style={{ width: `${60 + j * 15}%` }} />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Hoofdstukkaarten */}
        <div className="lg:col-span-8 space-y-4">
          {/* Toolbar skeleton */}
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-3 flex-wrap">
            <div className="flex-1 h-9 bg-gray-100 rounded-xl animate-pulse min-w-48" />
            {[72, 88, 80, 96].map((w, i) => (
              <div key={i} className="h-8 bg-gray-100 rounded-lg animate-pulse" style={{ width: w }} />
            ))}
          </div>

          {/* Topic header */}
          <div className="flex items-center gap-3 pt-2">
            <div className="w-7 h-7 bg-orange-200 rounded-lg animate-pulse" />
            <div className="h-5 w-40 bg-gray-200 rounded animate-pulse" />
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* 3 hoofdstukkaarten */}
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden"
            >
              <div className="p-6 space-y-3">
                {/* ID + woorden + copy-knop */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="h-3 w-12 bg-gray-200 rounded animate-pulse" />
                      <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" />
                    </div>
                    {/* Titel */}
                    <div className="h-6 bg-gray-200 rounded animate-pulse" style={{ width: `${65 + i * 8}%` }} />
                  </div>
                  <div className="h-9 w-32 bg-gray-100 rounded-xl animate-pulse shrink-0" />
                </div>

                {/* Samenvatting (2 regels) */}
                <div className="space-y-1.5">
                  <div className="h-3.5 bg-gray-100 rounded animate-pulse w-full" />
                  <div className="h-3.5 bg-gray-100 rounded animate-pulse" style={{ width: `${70 + i * 5}%` }} />
                </div>

                {/* Toggle knop */}
                <div className="h-4 w-40 bg-orange-100 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

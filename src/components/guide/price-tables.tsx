import { FALLBACK_ALBUM_PACKAGES, MV_PRICE_ROWS, type AlbumPackage } from "@/lib/review-guides";

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const stationOrder = FALLBACK_ALBUM_PACKAGES.at(-1)!.stations;
const sortStations = (stations: string[]) =>
  stations.slice().sort((a, b) => (stationOrder.indexOf(a) + 1 || 99) - (stationOrder.indexOf(b) + 1 || 99));

/** Album review packages with their stations, as the guides and the pricing page show them. */
export function AlbumPriceTable({ packages }: { packages: AlbumPackage[] }) {
  return (
    <div className="overflow-x-auto rounded-[8px] border-2 border-[#111111] dark:border-[#f2cf27]">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">음반 심의 방송국 패키지 비용</caption>
        <thead className="bg-[#f2cf27] text-[#111111]">
          <tr><th scope="col" className="whitespace-nowrap px-3 py-3 font-black sm:px-4">패키지</th><th scope="col" className="whitespace-nowrap px-3 py-3 font-black sm:px-4">비용</th><th scope="col" className="px-3 py-3 font-black sm:px-4">접수 방송국</th></tr>
        </thead>
        <tbody>
          {packages.map((item) => (
            <tr key={item.name} className="border-t-2 border-[#111111] align-top dark:border-[#f2cf27]/40">
              <th scope="row" className="whitespace-nowrap px-3 py-3 font-black sm:px-4">{item.name}</th>
              <td className="whitespace-nowrap px-3 py-3 font-black tabular-nums sm:px-4">{won(item.priceKrw)}</td>
              <td className="break-keep px-3 py-3 text-xs leading-6 text-muted-foreground sm:px-4 sm:text-sm">{sortStations(item.stations).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MvPriceTable() {
  return (
    <div className="overflow-x-auto rounded-[8px] border-2 border-[#111111] dark:border-[#f2cf27]">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">뮤직비디오 심의 비용</caption>
        <thead className="bg-[#1556a4] text-white">
          <tr><th scope="col" className="px-3 py-3 font-black sm:px-4">항목</th><th scope="col" className="whitespace-nowrap px-3 py-3 font-black sm:px-4">비용(영상 1건)</th></tr>
        </thead>
        <tbody>
          {MV_PRICE_ROWS.map((row) => (
            <tr key={row.label} className="border-t-2 border-[#111111] dark:border-[#f2cf27]/40">
              <th scope="row" className="break-keep px-3 py-3 font-semibold sm:px-4">{row.label}</th>
              <td className="whitespace-nowrap px-3 py-3 font-black tabular-nums sm:px-4">{won(row.priceKrw)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

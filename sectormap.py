"""One sector name per stock, used everywhere on the site.

Built from NSE's industry classification (saved in data/peers by the stock pages), rolled up into
about 30 groups a retail reader recognises. data/fno_sectors.json holds hand-checked placements for
F&O stocks and wins over the rule. Run this file to rebuild data/sectors.json."""
import html, json, os

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "data", "sectors.json")
HAND = os.path.join(ROOT, "data", "fno_sectors.json")
PEERS = os.path.join(ROOT, "data", "peers")
STATE = {"map": None}

BY_L2 = {
    "Finance": "NBFC & Housing Finance", "Insurance": "Insurance", "Capital Markets": "Capital Markets",
    "Financial Technology (Fintech)": "Internet", "Pharmaceuticals & Biotechnology": "Pharma",
    "Healthcare Services": "Hospitals", "Healthcare Equipment & Supplies": "Hospitals",
    "IT - Software": "IT Services", "IT - Services": "IT Services", "Engineering Services": "IT Services", "IT - Hardware": "Electronics",
    "Retailing": "Retail", "Automobiles": "Autos", "Agricultural, Commercial & Construction Vehicles": "Autos", "Auto Components": "Auto Components",
    "Industrial Products": "Capital Goods", "Industrial Manufacturing": "Capital Goods", "Electrical Equipment": "Electricals",
    "Consumer Durables": "Consumer Durables", "Oil": "Oil & Gas", "Petroleum Products": "Oil & Gas", "Gas": "Oil & Gas",
    "Consumable Fuels": "Metals & Mining", "Power": "Power", "Other Utilities": "Power",
    "Ferrous Metals": "Metals & Mining", "Non - Ferrous Metals": "Metals & Mining", "Minerals & Mining": "Metals & Mining",
    "Metals & Minerals Trading": "Metals & Mining", "Diversified Metals": "Metals & Mining",
    "Agricultural Food & other Products": "FMCG", "Food Products": "FMCG", "Beverages": "FMCG", "Personal Products": "FMCG",
    "Household Products": "FMCG", "Diversified FMCG": "FMCG", "Cigarettes & Tobacco Products": "FMCG",
    "Textiles & Apparels": "Textiles", "Chemicals & Petrochemicals": "Chemicals", "Fertilizers & Agrochemicals": "Chemicals",
    "Construction": "Infrastructure", "Realty": "Real Estate", "Cement & Cement Products": "Cement & Building",
    "Other Construction Materials": "Cement & Building", "Paper, Forest & Jute Products": "Paper & Packaging",
    "Aerospace & Defense": "Defence", "Transport Services": "Logistics", "Transport Infrastructure": "Logistics",
    "Leisure Services": "Travel", "Commercial Services & Supplies": "Business Services", "Other Consumer Services": "Business Services",
    "Entertainment": "Media", "Media": "Media", "Printing & Publication": "Media", "Telecom - Services": "Telecom",
    "Telecom -  Equipment & Accessories": "Telecom", "Diversified": "Conglomerates",
}


def of_path(path):
    path = [html.unescape(x) for x in (path or [])]
    if len(path) < 3:
        return None
    if path[2] == "Banks":
        return "PSU Banks" if len(path) > 3 and "Public" in path[3] else "Private Banks"
    return BY_L2.get(path[2])


def build():
    out = {}
    for f in os.listdir(PEERS):
        if not f.endswith(".json"):
            continue
        try:
            s = of_path(json.load(open(os.path.join(PEERS, f), encoding="utf8")).get("path"))
        except Exception:
            s = None
        if s:
            out[f[:-5]] = s
    out.update(json.load(open(HAND, encoding="utf8")))
    json.dump(out, open(OUT, "w", encoding="utf8"), indent=0)
    STATE["map"] = out
    return out


def load():
    if STATE["map"] is None:
        try:
            STATE["map"] = json.load(open(OUT, encoding="utf8"))
        except Exception:
            STATE["map"] = {}
    return STATE["map"]


if __name__ == "__main__":
    import collections
    m = build()
    print(len(m), collections.Counter(m.values()).most_common())

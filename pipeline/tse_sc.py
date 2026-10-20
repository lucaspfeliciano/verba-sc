"""Recorte SC/Florianópolis dos dados abertos do TSE -> arquivo SQL para o D1.

Lê só os CSVs de SC de dentro dos zips nacionais do TSE (via HTTP Range, sem
baixar o zip inteiro) e gera um .sql que substitui as tabelas do TSE no banco:

    python pipeline/tse_sc.py --out dados/tse.sql
    npx wrangler d1 execute verba-sc --remote --file dados/tse.sql

Recorte:
  - Cargos estaduais e federais por SC (deputado estadual e federal, senador e
    suplentes, governador e vice): eleições 2010, 2014, 2018, 2022 e 2026;
  - Prefeito, vice-prefeito e vereador de Florianópolis: 2016, 2020 e 2024.
  Receitas e despesas de campanha a partir de 2018 (formato uniforme no TSE).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import re
import sys
import unicodedata
import zipfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from httpzip import HttpRangeFile  # noqa: E402

csv.field_size_limit(1 << 24)

ODSELE = "https://cdn.tse.jus.br/estatistica/sead/odsele"
STATE_YEARS = (2010, 2014, 2018, 2022, 2026)
CITY_YEARS = (2016, 2020, 2024)
ACCOUNT_YEARS = (2018, 2020, 2022, 2024, 2026)
CITY = "FLORIANÓPOLIS"
CITY_OFFICES = {"PREFEITO", "VICE-PREFEITO", "VEREADOR"}
STATE_OFFICES = {"DEPUTADO ESTADUAL", "DEPUTADO FEDERAL", "SENADOR", "1º SUPLENTE", "2º SUPLENTE",
                 "GOVERNADOR", "VICE-GOVERNADOR"}
ELECTED = {"ELEITO", "ELEITO POR QP", "ELEITO POR MÉDIA", "MÉDIA"}
NULLS = {"", "#NULO", "#NULO#", "#NE", "-1", "-3", "-4"}

NOISE_TOKENS = {"LTDA", "LTD", "ME", "EPP", "EIRELI", "MEI", "SA", "SS"}


def normalize_name(s: str | None) -> str:
    """Idêntica a workers/ingest/util.ts:normalizeName."""
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).upper()
    s = re.sub(r"\bS\s*/\s*A\b", "SA", s)
    s = re.sub(r"[^A-Z0-9]+", " ", s).strip()
    tokens = [t for t in s.split(" ") if t]
    while len(tokens) > 1 and tokens[0].isdigit():
        tokens.pop(0)
    return " ".join(t for t in tokens if t not in NOISE_TOKENS)


def clean(v: str | None) -> str | None:
    v = (v or "").strip()
    return None if v in NULLS else v


def digits(v: str | None) -> str | None:
    d = re.sub(r"\D", "", v or "")
    return d if d and set(d) != {"0"} else None


def cents(v: str | None) -> int:
    v = (v or "0").strip().replace(".", "").replace(",", ".")
    try:
        return round(float(v) * 100)
    except ValueError:
        return 0


def iso_date(v: str | None) -> str | None:
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", v or "")
    return f"{m[3]}-{m[2]}-{m[1]}" if m else None


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def q(v) -> str:
    """Literal SQL."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


class SqlWriter:
    """INSERTs com várias linhas, cada instrução abaixo do limite de 100 KB do D1."""

    def __init__(self, fh):
        self.fh = fh

    def raw(self, sql: str):
        self.fh.write(sql.rstrip(";") + ";\n")

    def insert(self, table: str, cols: list[str], rows):
        head = f"INSERT INTO {table} ({', '.join(cols)}) VALUES "
        buf: list[str] = []
        size = len(head)
        n = 0
        for r in rows:
            t = "(" + ", ".join(q(r[c]) for c in cols) + ")"
            if buf and size + len(t) > 90_000:
                self.fh.write(head + ",\n".join(buf) + ";\n")
                buf, size = [], len(head)
            buf.append(t)
            size += len(t) + 2
            n += 1
        if buf:
            self.fh.write(head + ",\n".join(buf) + ";\n")
        return n


class Collections:
    def __init__(self):
        self.rows: list[dict] = []

    def add(self, dataset: str, scope: str, url: str, sha: str, size: int, rows: int) -> int:
        # IDs negativos: nunca colidem com a sequência automática usada pelo Worker.
        cid = -(len(self.rows) + 1)
        self.rows.append(dict(
            id=cid, source="tse", dataset=dataset, scope=scope, url=url, request_body=None,
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            http_status=200, bytes=size, sha256=sha, r2_key=None, rows=rows))
        return cid


def read_member(url: str, pattern: str):
    """Abre o membro do zip remoto cujo nome casa com `pattern`; devolve (nome, bytes)."""
    f = HttpRangeFile(url)
    z = zipfile.ZipFile(f)
    names = [i.filename for i in z.infolist() if re.fullmatch(pattern, i.filename, re.I)]
    if not names:
        raise FileNotFoundError(f"{pattern} não encontrado em {url}")
    with z.open(names[0]) as m:
        data = m.read()
    print(f"  {url.rsplit('/', 1)[1]} :: {names[0]} ({len(data) / 1e6:.1f} MB, baixados {f.bytes_fetched / 1e6:.1f} MB)",
          file=sys.stderr)
    return names[0], data


def dict_rows(data: bytes):
    text = io.TextIOWrapper(io.BytesIO(data), encoding="latin-1", newline="")
    yield from csv.DictReader(text, delimiter=";")


def in_scope(year: int, uf: str, office: str, unit: str) -> bool:
    if uf != "SC":
        return False
    if year in STATE_YEARS:
        return office in STATE_OFFICES
    return unit == CITY and office in CITY_OFFICES


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="dados/tse.sql")
    args = ap.parse_args()

    cols = Collections()
    politicians: dict[str, dict] = {}
    candidacies: dict[str, dict] = {}

    # 1) Candidaturas -------------------------------------------------------
    for year in sorted(STATE_YEARS + CITY_YEARS):
        url = f"{ODSELE}/consulta_cand/consulta_cand_{year}.zip"
        name, data = read_member(url, rf"consulta_cand_{year}_SC\.csv")
        kept = 0
        cid = None
        best_turn: dict[str, int] = {}
        rows = list(dict_rows(data))
        for r in rows:
            # 2010 usa "1º SUPLENTE SENADOR"; depois, só "1º SUPLENTE".
            office = (r.get("DS_CARGO") or "").upper().strip().removesuffix(" SENADOR")
            unit = (r.get("NM_UE") or "").upper().strip()
            if not in_scope(year, r.get("SG_UF", ""), office, unit):
                continue
            # O TSE reaproveita SQ_CANDIDATO entre eleições: a chave inclui o ano.
            sq = f"{year}-{r['SQ_CANDIDATO']}"
            turn = int(r.get("NR_TURNO") or 1)
            if best_turn.get(sq, 0) >= turn:
                continue
            best_turn[sq] = turn
            titulo = digits(r.get("NR_TITULO_ELEITORAL_CANDIDATO"))
            cpf = digits(r.get("NR_CPF_CANDIDATO"))
            key_src = titulo or cpf or f"{normalize_name(r['NM_CANDIDATO'])}|{r.get('DT_NASCIMENTO')}"
            pid = hashlib.sha256(key_src.encode()).hexdigest()[:16]
            result = (clean(r.get("DS_SIT_TOT_TURNO")) or "").upper()
            p = politicians.setdefault(pid, dict(id=pid, name=r["NM_CANDIDATO"].strip(), cpf=None, birth_date=None,
                                                 gender=None, ballot_name=None, last_year=0))
            if year >= p["last_year"]:
                p.update(name=r["NM_CANDIDATO"].strip(), ballot_name=r["NM_URNA_CANDIDATO"].strip(), last_year=year,
                         birth_date=iso_date(r.get("DT_NASCIMENTO")) or p["birth_date"],
                         gender=clean(r.get("DS_GENERO")) or p["gender"])
            p["cpf"] = p["cpf"] or cpf
            candidacies[sq] = dict(
                sq_candidato=sq, politician_id=pid, year=year, office=office,
                unit="SC" if year in STATE_YEARS else CITY,
                number=clean(r.get("NR_CANDIDATO")), party=clean(r.get("SG_PARTIDO")),
                ballot_name=r["NM_URNA_CANDIDATO"].strip(),
                status=clean(r.get("DS_SITUACAO_CANDIDATURA")) or clean(r.get("DS_DETALHE_SITUACAO_CAND")),
                result=result or None, elected=result in ELECTED, campaign_cnpj=None, collection_id=None)
            kept += 1
        cid = cols.add("candidaturas", str(year), f"{url}#{name}", hashlib.sha256(data).hexdigest(), len(data), kept)
        for c in candidacies.values():
            if c["year"] == year:
                c["collection_id"] = cid
        print(f"{year}: {kept} candidaturas no recorte", file=sys.stderr)

    # 2) Bens declarados ----------------------------------------------------
    assets: list[dict] = []
    for year in sorted(STATE_YEARS + CITY_YEARS):
        url = f"{ODSELE}/bem_candidato/bem_candidato_{year}.zip"
        name, data = read_member(url, rf"bem_candidato_{year}_SC\.csv")
        n0 = len(assets)
        for r in dict_rows(data):
            if f"{year}-{r['SQ_CANDIDATO']}" in candidacies:
                assets.append(dict(sq_candidato=f"{year}-{r['SQ_CANDIDATO']}", kind=clean(r.get("DS_TIPO_BEM_CANDIDATO")),
                                   description=clean(r.get("DS_BEM_CANDIDATO")),
                                   amount_cents=cents(r.get("VR_BEM_CANDIDATO")), collection_id=None))
        cid = cols.add("bens", str(year), f"{url}#{name}", hashlib.sha256(data).hexdigest(), len(data), len(assets) - n0)
        for a in assets[n0:]:
            a["collection_id"] = cid

    # 3) Receitas e despesas contratadas -------------------------------------
    receipts: list[dict] = []
    expenses: list[dict] = []
    for year in ACCOUNT_YEARS:
        url = f"{ODSELE}/prestacao_contas/prestacao_de_contas_eleitorais_candidatos_{year}.zip"
        try:
            name, data = read_member(url, rf"receitas_candidatos_{year}_SC\.csv")
        except FileNotFoundError as e:
            print(f"  aviso: {e}", file=sys.stderr)
            continue
        n0 = len(receipts)
        for r in dict_rows(data):
            c = candidacies.get(f"{year}-{r['SQ_CANDIDATO']}")
            if not c:
                continue
            c["campaign_cnpj"] = c["campaign_cnpj"] or digits(r.get("NR_CNPJ_PRESTADOR_CONTA"))
            donor = clean(r.get("NM_DOADOR_RFB")) or clean(r.get("NM_DOADOR"))
            receipts.append(dict(
                sq_candidato=c["sq_candidato"], donor_doc=digits(r.get("NR_CPF_CNPJ_DOADOR")), donor_name=donor,
                donor_name_norm=normalize_name(donor) if donor else None,
                origin=clean(r.get("DS_ORIGEM_RECEITA")), fund=clean(r.get("DS_FONTE_RECEITA")),
                kind=clean(r.get("DS_ESPECIE_RECEITA")), received_at=iso_date(r.get("DT_RECEITA")),
                amount_cents=cents(r.get("VR_RECEITA")), collection_id=None))
        cid = cols.add("receitas", str(year), f"{url}#{name}", hashlib.sha256(data).hexdigest(), len(data), len(receipts) - n0)
        for x in receipts[n0:]:
            x["collection_id"] = cid
        del data

        name, data = read_member(url, rf"despesas_contratadas_candidatos_{year}_SC\.csv")
        n0 = len(expenses)
        for r in dict_rows(data):
            c = candidacies.get(f"{year}-{r['SQ_CANDIDATO']}")
            if not c or cents(r.get("VR_DESPESA_CONTRATADA")) == 0:
                continue
            supplier = clean(r.get("NM_FORNECEDOR_RFB")) or clean(r.get("NM_FORNECEDOR"))
            expenses.append(dict(
                sq_candidato=c["sq_candidato"], supplier_doc=digits(r.get("NR_CPF_CNPJ_FORNECEDOR")),
                supplier_name=supplier, supplier_name_norm=normalize_name(supplier) if supplier else None,
                category=clean(r.get("DS_ORIGEM_DESPESA")), description=clean(r.get("DS_DESPESA")),
                spent_at=iso_date(r.get("DT_DESPESA")), amount_cents=cents(r.get("VR_DESPESA_CONTRATADA")),
                collection_id=None))
        cid = cols.add("despesas_contratadas", str(year), f"{url}#{name}", hashlib.sha256(data).hexdigest(), len(data),
                       len(expenses) - n0)
        for x in expenses[n0:]:
            x["collection_id"] = cid
        del data
        print(f"{year}: {len(receipts)} receitas, {len(expenses)} despesas acumuladas", file=sys.stderr)

    # 4) Slugs estáveis -------------------------------------------------------
    used: set[str] = set()
    for p in sorted(politicians.values(), key=lambda p: (-p["last_year"], p["id"])):
        base = slugify(p["ballot_name"] or p["name"]) or p["id"]
        slug = base if base not in used else f"{base}-{p['id'][:4]}"
        used.add(slug)
        p["slug"] = slug
        p["name_norm"] = normalize_name(p["name"])
        p["ballot_norm"] = normalize_name(p["ballot_name"])
        p["photo_url"] = None

    # 5) SQL -------------------------------------------------------------------
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8", newline="\n") as fh:
        w = SqlWriter(fh)
        # O D1 aplica a importação remota em lotes, então cada instrução precisa deixar
        # as chaves estrangeiras válidas (PRAGMA defer_foreign_keys não cobre o arquivo).
        # Ligações automáticas e sinais são recalculados pelo Workflow ("derive");
        # ligações manuais são guardadas e devolvidas no fim.
        w.raw("DROP TABLE IF EXISTS _keep_links")
        w.raw("CREATE TABLE _keep_links AS SELECT * FROM mandate_link WHERE method = 'manual'")
        w.raw("DELETE FROM mandate_link")
        w.raw("UPDATE signal SET politician_id = NULL")
        for t in ("declared_asset", "campaign_expense", "campaign_receipt", "candidacy", "politician"):
            w.raw(f"DELETE FROM {t}")
        w.raw("DELETE FROM collection WHERE source = 'tse'")
        w.insert("collection", ["id", "source", "dataset", "scope", "url", "request_body", "fetched_at", "http_status",
                                "bytes", "sha256", "r2_key", "rows"], cols.rows)
        w.insert("politician", ["id", "slug", "name", "ballot_name", "name_norm", "ballot_norm", "cpf", "birth_date",
                                "gender", "photo_url"], politicians.values())
        w.insert("candidacy", ["sq_candidato", "politician_id", "year", "office", "unit", "number", "party",
                               "ballot_name", "status", "result", "elected", "campaign_cnpj", "collection_id"],
                 candidacies.values())
        w.insert("declared_asset", ["sq_candidato", "kind", "description", "amount_cents", "collection_id"], assets)
        w.insert("campaign_receipt", ["sq_candidato", "donor_doc", "donor_name", "donor_name_norm", "origin", "fund",
                                      "kind", "received_at", "amount_cents", "collection_id"], receipts)
        w.insert("campaign_expense", ["sq_candidato", "supplier_doc", "supplier_name", "supplier_name_norm", "category",
                                      "description", "spent_at", "amount_cents", "collection_id"], expenses)
        w.raw("INSERT INTO mandate_link SELECT * FROM _keep_links WHERE politician_id IN (SELECT id FROM politician)")
        w.raw("DROP TABLE _keep_links")

    print(f"ok: {len(politicians)} pessoas, {len(candidacies)} candidaturas, {len(assets)} bens, "
          f"{len(receipts)} receitas, {len(expenses)} despesas -> {out} ({out.stat().st_size / 1e6:.1f} MB)",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""RTV-231 — copia estudos de um dcm4chee-arc para o Orthanc do docker-compose.yml.

Existe porque o Orthanc do RTV-3 nasce vazio: para usar o stack isolado com dados
de verdade, alguém tem de alimentá-lo. No DEV1 a fonte natural é o `rt-arc-1`, que
já tem CT/RTPLAN/RTSTRUCT/RTIMAGE.

Caminho: QIDO-RS lista os estudos -> WADO-RS baixa cada instância como
`application/dicom` -> POST cru em /instances do Orthanc. Só stdlib — sem
requests, sem pydicom, sem pynetdicom.

Idempotente: o Orthanc devolve o mesmo ID para uma instância já armazenada, então
rodar duas vezes não duplica nada.

    python3 docker/seed-orthanc-from-dcm4chee.py --dry-run
    python3 docker/seed-orthanc-from-dcm4chee.py --limit 3
    python3 docker/seed-orthanc-from-dcm4chee.py --aet AUTOSEG
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

DEFAULT_DCM4CHEE = "http://localhost:8080"
DEFAULT_AET = "RTPACS"
DEFAULT_ORTHANC = "http://localhost:8042"


def _get(url, accept):
    req = urllib.request.Request(url, headers={"Accept": accept})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def _tag(item, tag, default=""):
    """Primeiro valor de uma tag num objeto DICOM JSON."""
    values = (item.get(tag) or {}).get("Value") or []
    if not values:
        return default
    v = values[0]
    if isinstance(v, dict):  # PN vem como {"Alphabetic": "..."}
        return v.get("Alphabetic", default)
    return v


def qido(base, path, accept="application/dicom+json"):
    raw = _get("%s%s" % (base, path), accept)
    if not raw.strip():
        return []
    return json.loads(raw)


def post_dicom(orthanc, blob):
    req = urllib.request.Request(
        "%s/instances" % orthanc,
        data=blob,
        headers={"Content-Type": "application/dicom"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read() or b"{}")


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dcm4chee", default=DEFAULT_DCM4CHEE, help="default: %s" % DEFAULT_DCM4CHEE)
    p.add_argument("--aet", default=DEFAULT_AET, help="AET de origem. default: %s" % DEFAULT_AET)
    p.add_argument("--orthanc", default=DEFAULT_ORTHANC, help="default: %s" % DEFAULT_ORTHANC)
    p.add_argument("--limit", type=int, default=0, help="copiar no máximo N estudos (0 = todos)")
    p.add_argument("--dry-run", action="store_true", help="só listar, não copiar")
    args = p.parse_args()

    rs = "%s/dcm4chee-arc/aets/%s/rs" % (args.dcm4chee.rstrip("/"), args.aet)
    orthanc = args.orthanc.rstrip("/")

    try:
        studies = qido(rs, "/studies?limit=500&includefield=00080061,00081030")
    except urllib.error.URLError as e:
        sys.exit("Falhou ao consultar %s: %s\nO dcm4chee está no ar? O AET %r existe?"
                 % (rs, e, args.aet))

    if not studies:
        sys.exit("Nenhum estudo em %s — nada para copiar." % rs)

    if args.limit:
        studies = studies[: args.limit]

    print("%d estudo(s) em %s" % (len(studies), rs))
    for s in studies:
        uid = _tag(s, "0020000D")
        print("  %s | %-10s | %s" % (uid, _tag(s, "00080061"), _tag(s, "00081030")[:46]))

    if args.dry_run:
        print("\n--dry-run: nada foi copiado.")
        return

    if not orthanc:
        sys.exit("--orthanc vazio.")

    total_ok = total_fail = 0
    for s in studies:
        study_uid = _tag(s, "0020000D")
        if not study_uid:
            continue
        try:
            instances = qido(rs, "/studies/%s/instances" % study_uid)
        except urllib.error.URLError as e:
            print("  ! %s: falhou ao listar instâncias: %s" % (study_uid, e))
            total_fail += 1
            continue

        print("\n%s — %d instância(s)" % (study_uid, len(instances)))
        for inst in instances:
            series_uid = _tag(inst, "0020000E")
            sop_uid = _tag(inst, "00080018")
            if not (series_uid and sop_uid):
                continue
            url = "%s/studies/%s/series/%s/instances/%s" % (rs, study_uid, series_uid, sop_uid)
            try:
                blob = _get(url, "application/dicom")
                post_dicom(orthanc, blob)
                total_ok += 1
                print("  ok  %s (%d bytes)" % (sop_uid[-24:], len(blob)))
            except urllib.error.HTTPError as e:
                total_fail += 1
                print("  !   %s: HTTP %s %s" % (sop_uid[-24:], e.code, e.reason))
            except urllib.error.URLError as e:
                total_fail += 1
                print("  !   %s: %s" % (sop_uid[-24:], e))

    print("\n%d instância(s) copiada(s), %d falha(s)." % (total_ok, total_fail))
    if total_fail:
        sys.exit(1)


if __name__ == "__main__":
    main()

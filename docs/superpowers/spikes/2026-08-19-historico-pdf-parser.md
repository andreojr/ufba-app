# Spike: extrair dado útil do PDF do Histórico Escolar (SIGAA/UFBA)

**Data:** 2026-08-19
**Pergunta:** o PDF do histórico dá pra parsear? Com que lib, e ele contém todos os
campos que a tela de Trajetória precisa?
**Veredito:** sim, com alta confiança. `pdf-parse@^2.4.5` usando geometria (x/y).
Protótipo parseou 49/49 componentes cursados e 20/20 pendentes do documento real,
com o CR recalculado batendo exatamente o do cabeçalho. Maior risco: só temos **um**
documento de exemplo.

Documento investigado: histórico real de um discente ativo de Engenharia da
Computação, 3 páginas. Não está no repositório (dado pessoal).

## Extração de texto

`Creator: JasperReports (HistoricoDiscenteGraduacao_UFBA)`, `Producer: iText 2.1.7`,
PDF 1.4, fontes Helvetica Type1 WinAnsi não embutidas. Camada de texto real — não é
scan, não precisa de OCR.

| Abordagem | Resultado |
|---|---|
| `pdftotext` sem `-layout` | Inutilizável. A ordem de pintura do iText dissocia label e valor ("Nome:" numa linha, o valor três linhas depois). |
| `pdftotext -layout` | Funciona bem, mas exige o binário do poppler na imagem de deploy. |
| `pdf-parse` v2 `getText()` | Inutilizável — mesmo embaralhamento (não reconstrói layout). |
| `pdf-parse` v2 `load()` → pdfjs | **Escolhido.** `getTextContent()` dá x/y e `fontName` de cada item; as colunas têm x fixo (variação < 3 pt entre páginas). |

Por que não `pdfjs-dist` direto: v5+ é ESM-only e o backend Nest compila CJS.
`pdf-parse` v2 embute o pdfjs e tem entry CJS — mesma capacidade, sem fricção de build.

Geometria de uma linha de componente:

```
x= 41.3  semestre "2023.1"   x= 73.9  natureza "OB"   x= 94.1  código "FISD36"
x=129.0  nome (baseline +3.5pt quando há linha de docente; no baseline quando não há)
x=129.0  docente, y -3.5pt, Helvetica-Oblique: "Dr. NOME DO DOCENTE (60h)"
x≈487    CH "60"   x≈508-511  nota "6.8"   x≈535-538  situação "APR"
```

## Mapa do documento

**Página 1** — cabeçalho institucional (repete em toda página, inclui o aviso
"DOCUMENTO OFICIAL, SUJEITO A AJUSTES DEVIDO À MIGRAÇÃO DE SISTEMA"); Dados
Pessoais (nome, matrícula, nascimento, CPF, RG); Dados do Vínculo (curso, status,
currículo `G20251 - 2025.2`, ingresso `2023.1 - 14/03/2023`, forma de ingresso,
período letivo atual, prazo de conclusão padrão/máximo, suspensões, prorrogações);
box **Índices Acadêmicos** com `IAP` e `CR` (4 casas, ponto decimal); início da
tabela de componentes cursados.

**Página 2** — continuação da tabela (cada linha carrega o próprio semestre, então a
quebra de página é trivial) e a **legenda** de naturezas e situações, que vaza pra
página 3.

**Página 3** — quadro de **Carga Horária e Créditos Integralizados/Pendentes**
(matriz Exigido/Integralizado/Pendente × Obrigatórias/Optativos/Complementares/Total);
**Componentes Curriculares Obrigatórios Pendentes:20** (contagem colada no título);
**Equivalências**; **Observações**. Rodapé com código de verificação em toda página.

### Não existe no documento

Não assumir que estão lá: componentes **optativos pendentes** listados
individualmente (só o agregado de horas), detalhamento de atividades
complementares, coluna de **frequência**, seção de aproveitamento externo, e
qualquer índice além de IAP e CR (sem MC, IRA, IECH).

## Mapeamento pros campos da tela

Referência: `TRANSCRIPT_SUMMARY`, `PERIODS`, `PENDING_COURSES` em
`mobile/src/lib/mock-data.ts`.

| Campo | Origem |
|---|---|
| coeficiente | **Direto**, âncora `CR:`. Fórmula confirmada com os números reais: Σ(nota×CH)/ΣCH sobre componentes com nota (APR + REP; TRANC e MATR ficam fora do numerador *e* do denominador) = 17625.0/2160 = 8.1597, exato. Escala 0–10. |
| `IAP` | Vem pronto (escala 0–1). Fórmula **não** identificada — várias ponderações testadas, nenhuma bate. Não precisa: é leitura direta. |
| carga horária concluída | **Direto**, linha `Integralizado` × coluna `Total`. |
| carga horária exigida | **Direto**, linha `Exigido` × coluna `Total`. |
| % de progresso | **Derivável** (integralizado/exigido). Não existe pronto. |
| "faltam N matérias" | **Direto**, o `:20` do título, ou o tamanho da lista. Ressalvas: só obrigatórias, e inclui duas linhas de ENADE com 0h. |
| período de cada bloco | **Direto**, coluna Semestre, formato `YYYY.N`. Agrupar as linhas por semestre. |
| concluído vs. em curso | **Derivável**: semestre com alguma linha `MATR` é o em curso. Confere com "Período Letivo Atual". |
| código / nome | **Direto**. |
| nota | **Direto**, **ponto** decimal e 1 casa (`6.8`, `10.0`); `--` para TRANC e MATR. |
| frequência | **Não existe.** Só a situação `REPF`/`REPMF` codifica reprovação por falta. |
| situação | Aparecem no doc: `APR`, `REP`, `TRANC`, `MATR`. A legenda define o universo: + `CANC, DISP, REPF, REPMF, TRANS, INCORP, CUMP`. |
| natureza | Aparecem `OB`, `EB`, `OP` e **vazia** (nas linhas TRANC o campo some, não vira "-"). |
| docente | Linha própria em itálico, `[Título. ]NOME (60h)`; título opcional e a linha inteira pode faltar. |
| pendentes | Código, nome, CH e a anotação `Matriculado` quando o pendente está sendo cursado agora. |
| horizonte de planejamento | "Prazo para Conclusão (Padrão / Máximo)" vem direto e limita os períodos futuros. |

## Fragilidades que o parser precisa tratar

Confirmadas no documento:

1. **Linha de docente opcional** — quando falta, o nome fica no baseline em vez de +3.5pt.
2. **Natureza vazia** nas linhas TRANC — a coluna não emite item. Fatiar por faixa de x, nunca split por whitespace.
3. **Mesmo código em semestres diferentes** — TRANC seguido de REP, TRANC seguido de APR. A chave natural precisa do semestre, e a UI precisa de regra de precedência pra não agregar por código.
4. **ENADE duplicado** nos pendentes, com nomes diferentes — chave só por código colide.
5. **Colunas deslocam ±3 pt entre páginas** — faixas com folga, nunca igualdade.
6. **Formatos inconsistentes** — `"60 h"` vs `"0h"`, nota `--`, contagem colada no título.
7. **Legenda atravessa a página** e o y do rodapé muda — delimitar seções por âncora de texto, não por posição de página.
8. **Cabeçalho de continuação** ("Nome: … Matrícula: …") no meio do fluxo das páginas 2 e 3.

Prováveis em outros históricos, sem exemplar aqui: nome de componente quebrando
linha (distinguir do docente pela fonte — Oblique); linha de componente cruzando
quebra de página; múltiplos vínculos; `DISP`/`CUMP`/aproveitamento em linha.

### Invariantes que o documento permite validar

O parser deve conferir e **lançar erro em vez de persistir** se divergir:

- Σ CH das linhas `APR` (+`EB`) == "Integralizado / Total" (2100 no doc ✓)
- CR recalculado == CR do cabeçalho, tolerância 0.0001 (✓)
- nº de linhas de pendentes == contagem do título (20 ✓)

Mesmo espírito do `fetchHistorico`, que valida o magic `%PDF` em vez de entregar lixo.

## Desenho proposto

**Dependência nova:** `pdf-parse@^2.4.5` em prod. Puro JS, sem binário nativo,
~57 MB em node_modules, entry CJS compatível com o build do Nest e com ts-jest.
Roda no Railway sem configuração extra.

**Dois arquivos**, no padrão de `parsers/`:

- `parsers/historico-texto.ts` — o único que toca `pdf-parse`. `Buffer` → itens
  posicionados (`{ pagina, x, y, texto, italico }`).
- `parsers/historico.ts` — parser **puro e síncrono**: `ItemTexto[]` → domínio.
  Testável sem PDF nenhum.

Algoritmo validado pelo protótipo: delimitar seções por âncoras de texto; na tabela,
cada item `^\d{4}\.\d$` com x < 60 é o baseline de uma linha; células por faixa de x
com tolerância; nome = itens não-itálicos na faixa 125–480 com y ∈ [baseline−1,
baseline+8]; docente = itens itálicos com y ∈ [baseline−8, baseline−1].

**Não extrair nem persistir CPF, RG ou data de nascimento** — a matrícula já está em
`User`, o resto é dado sensível que a tela não usa.

**Persistência:** snapshot integral por usuário, substituído a cada sync (delete +
insert na mesma transação). O PDF é o estado completo; upsert linha a linha deixaria
lixo de linhas removidas por ajuste de matrícula. `situacao` e `natureza` como String,
não enum de banco: a legenda pode ganhar valores numa migração do SIGAA e um enum
transformaria isso em falha de insert — o tipo TypeScript já restringe no parser.

**Fixture:** dump do `ItemTexto[]` do documento real como JSON, **anonimizado antes de
commitar** (nome, matrícula, CPF, RG, nascimento e código de verificação trocados por
valores fictícios; as posições x/y não dependem do conteúdo). O PDF real **não** vai
pro repositório nem anonimizado — anonimizar binário de PDF com confiança é frágil.
Pra cobrir a ponte `pdf-parse` → `ItemTexto`, um PDF sintético de uma página gerado
no próprio teste.

## Achados que contradizem o mock atual

- A nota vem com **ponto**, não vírgula — conversão é de exibição.
- **Não existe frequência** no documento.
- "faltam N matérias" só vale pra **obrigatórias**, e inclui ENADE.
- O "coeficiente" da tela deve ser o **CR**; o IAP é outro índice, escala 0–1.
- **Optativas pendentes não são enumeradas** — só o agregado de horas. Um pool de
  planejamento alimentado apenas pelo histórico terá só obrigatórias.

# Códigos de horário do SIGAA — formato e algoritmo de tradução

Fonte: análise do código-fonte da extensão [ernestosrf/sigaa-horarios-extension](https://github.com/ernestosrf/sigaa-horarios-extension) (`content.js`, verificado via `curl` do raw file em 2026-08-18, licença/uso: extensão pública de código aberto, só lida — nada foi copiado literalmente pro Gradline, isso aqui é a documentação do formato que ela decodifica).

Esse formato bate com os códigos reais observados na investigação do SIGAA da UFBA ([sigaa-investigation spike](../superpowers/spikes/2026-08-17-sigaa-investigation.md)): `2N34`, `35N12`, etc.

## Formato do código

```
[dias da semana][turno][horários]
```

Regex de reconhecimento usada pela extensão: `^([2-7]+)([MTN])(\d+)$`

- **Dias da semana** — um ou mais dígitos de `2` a `7`, cada um representando um dia (pode ter mais de um dia, ex: `35` = terça e quinta):

  | Código | Dia |
  |---|---|
  | 2 | Segunda |
  | 3 | Terça |
  | 4 | Quarta |
  | 5 | Quinta |
  | 6 | Sexta |
  | 7 | Sábado |

  (Sem código pra domingo — SIGAA não agenda aulas nesse dia.)

- **Turno** — uma letra: `M` (Manhã), `T` (Tarde), `N` (Noite).

- **Horários** — um ou mais dígitos, cada um representando um "slot" de aula dentro do turno (não é a hora do relógio, é o índice do período de aula). A tabela de slot → horário real depende do turno:

  | Slot | Manhã (M) | Tarde (T) | Noite (N) |
  |---|---|---|---|
  | 1 | 7h00 – 7h55 | 13h00 – 13h55 | 18h30 – 19h25 |
  | 2 | 7h55 – 8h50 | 13h55 – 14h50 | 19h25 – 20h20 |
  | 3 | 8h50 – 9h45 | 14h50 – 15h45 | 20h20 – 21h15 |
  | 4 | 9h45 – 10h40 | 15h45 – 16h40 | 21h15 – 22h10 |
  | 5 | 10h40 – 11h35 | 16h40 – 17h35 | — |
  | 6 | 11h35 – 12h30 | 17h35 – 18h30 | — |

  Noite só tem 4 slots (não existe `N5`/`N6`).

## Algoritmo de tradução

1. Validar o código contra a regex `^([2-7]+)([MTN])(\d+)$`; se não bater, é inválido.
2. Mapear cada dígito de dias pro nome do dia (`dayMap`), na ordem em que aparecem.
3. Mapear cada dígito de horário pro slot correspondente **dentro do turno já identificado** (`timeMap[turno][slot]`).
4. **Agrupar slots consecutivos** num único intervalo: percorre os slots em sequência, e enquanto o próximo slot for `atual + 1`, estende o intervalo em vez de criar um novo. Isso produz blocos do tipo "20h20 – 22h10" em vez de "20h20-21h15, 21h15-22h10" pra um código como `N34`.
   - Importante: a extensão assume que os dígitos de horário já vêm em ordem crescente no código original (não ordena antes de agrupar) — se algum dia o SIGAA mandar fora de ordem, o agrupamento quebra silenciosamente. Vale ordenar antes de agrupar na nossa implementação, por robustez.
5. Montar o texto final: `{dias join " e "} - {turno} ({intervalos join ", "})`.

### Exemplos (batendo com dados reais da investigação)

- `2N34` → dia `2`=Segunda, turno `N`=Noite, slots `3`,`4` consecutivos → **"Segunda - Noite (20h20 - 22h10)"**
- `35N12` → dias `3`=Terça, `5`=Quinta, turno `N`=Noite, slots `1`,`2` consecutivos → **"Terça e Quinta - Noite (18h30 - 20h20)"**

## Limitações conhecidas da lógica original (a corrigir na nossa implementação)

- Não ordena os slots de horário antes de agrupar — assume ordem crescente no código-fonte. Nossa versão deve ordenar (`sort`) antes de agrupar, por segurança.
- Não trata slots fora da tabela (`M7`, `N5`, etc.) além de simplesmente ignorá-los silenciosamente (o loop só empurra pra `timeSlots` se `timeMap[shift]?.[timeCode]` existir) — um slot inválido nesse meio é descartado sem aviso. Preferimos logar/alertar em vez de descartar silenciosamente.
- Não lida com múltiplos turnos no mesmo código (não é um caso observado no SIGAA, mas vale um teste de none-match explícito).

## Onde isso entra no Gradline

Essa tradução deve virar uma função utilitária pura (ex: `parseSigaaScheduleCode(code: string): { days: string[]; shift: string; timeRanges: string[] }`), testável isoladamente com os exemplos acima como fixtures, usada tanto:
- no backend, ao normalizar os dados de horário extraídos do portal (`Componente Curricular` / `Local` / `Horário` — ver spike), antes de devolver JSON pro app;
- ou no app mobile, se decidirmos manter o código cru vindo da API e traduzir só na camada de apresentação (a decidir na spec de arquitetura — ainda não fechamos onde essa tradução deve morar).

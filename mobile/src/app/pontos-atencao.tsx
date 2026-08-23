import { useFocusEffect, useRouter } from "expo-router";
import { Button, Spinner, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBar } from "@/components/AppBar";
import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { describeApiError } from "@/lib/api-errors";
import { deleteVotoPontoAtencao, getPontosAtencao, putVotoPontoAtencao } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { parseIsoDate } from "@/lib/periodo-letivo";
import { diasAte } from "@/lib/pontos-atencao";
import type { PontoAtencao, ValorVoto } from "@/lib/types";

type Estado =
  | { status: "loading" }
  | { status: "ready"; pontos: PontoAtencao[] }
  | { status: "erro"; mensagem: string };

const ICONE_TIPO: Record<PontoAtencao["tipo"], AppIconName> = {
  TRABALHO: "IconFileText",
  PROVA: "IconFlag",
};

function formatarDiaMes(data: string): string {
  const alvo = parseIsoDate(data);
  const dia = String(alvo.getDate()).padStart(2, "0");
  const mes = String(alvo.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}`;
}

/**
 * Três grupos fixos, nesta ordem — contestado é assunto só desta tela (ver
 * PontosAtencaoSection e intercalarDia, que o excluem de tudo o mais), e um
 * item vencido não deixa de existir: ele só some das superfícies "o que vem
 * a seguir" e passa a viver aqui, pra referência.
 */
function agrupar(
  pontos: PontoAtencao[],
  agora: Date,
): { proximos: PontoAtencao[]; contestados: PontoAtencao[]; vencidos: PontoAtencao[] } {
  const proximos: PontoAtencao[] = [];
  const contestados: PontoAtencao[] = [];
  const vencidos: PontoAtencao[] = [];

  for (const ponto of pontos) {
    if (ponto.estado === "CONTESTADO") {
      contestados.push(ponto);
      continue;
    }
    if (diasAte(ponto.data, agora) >= 0) {
      proximos.push(ponto);
    } else {
      vencidos.push(ponto);
    }
  }

  const porData = (a: PontoAtencao, b: PontoAtencao) =>
    a.data.localeCompare(b.data) || (a.hora ?? "").localeCompare(b.hora ?? "");
  proximos.sort(porData);
  vencidos.sort(porData);
  contestados.sort(porData);

  return { proximos, contestados, vencidos };
}

function BotaoVoto({
  testID,
  ativo,
  contagem,
  icone,
  onPress,
}: {
  testID: string;
  ativo: boolean;
  contagem: number;
  icone: AppIconName;
  onPress: () => void;
}): JSX.Element {
  const [accentColor, mutedColor] = useThemeColor(["accent", "muted"]);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      className={`flex-row items-center gap-1.5 rounded-full px-3 py-1.5 ${
        ativo ? "bg-accent-soft" : "bg-surface-secondary"
      }`}
    >
      <AppIcon name={icone} size={14} color={ativo ? accentColor : mutedColor} />
      <Typography.Paragraph
        type="body-xs"
        weight="medium"
        className={`font-mono ${ativo ? "text-accent" : "text-muted"}`}
      >
        {contagem}
      </Typography.Paragraph>
    </Pressable>
  );
}

function ItemPontoAtencao({
  ponto,
  vencido,
  onVotar,
  onCorrigir,
}: {
  ponto: PontoAtencao;
  vencido: boolean;
  onVotar: (ponto: PontoAtencao, valor: ValorVoto) => void;
  onCorrigir: (ponto: PontoAtencao) => void;
}): JSX.Element {
  const mutedColor = useThemeColor("muted");
  const contestado = ponto.estado === "CONTESTADO";
  const dimmed = contestado || vencido;

  return (
    <View
      testID={`ponto-${ponto.id}`}
      className={`rounded-3xl bg-surface-secondary p-4 gap-2.5 ${dimmed ? "opacity-60" : ""}`}
    >
      <View className="flex-row items-center gap-1.5">
        <AppIcon name={ICONE_TIPO[ponto.tipo]} size={14} color={mutedColor} />
        <Typography.Paragraph type="body-xs" color="muted">
          {(ponto.turmaCodigo ?? ponto.turmaNome) + " · " + formatarDiaMes(ponto.data)}
        </Typography.Paragraph>
      </View>

      <Typography.Paragraph weight="medium">{ponto.titulo}</Typography.Paragraph>

      {ponto.responsavel ? (
        <Typography.Paragraph type="body-xs" color="muted">
          Responsável: {ponto.responsavel.nome}
        </Typography.Paragraph>
      ) : null}

      {contestado ? (
        <>
          <Typography.Paragraph testID={`contestacoes-${ponto.id}`} type="body-xs" className="text-danger">
            {ponto.contestacoes === 1
              ? "1 colega contestou esta data"
              : `${ponto.contestacoes} colegas contestaram esta data`}
          </Typography.Paragraph>
          <Button
            testID={`corrigir-${ponto.id}`}
            variant="outline"
            size="sm"
            onPress={() => onCorrigir(ponto)}
          >
            Corrigir
          </Button>
        </>
      ) : vencido ? null : (
        <View className="flex-row gap-2.5">
          <BotaoVoto
            testID={`confirmar-${ponto.id}`}
            ativo={ponto.meuVoto === "CONFIRMA"}
            contagem={ponto.confirmacoes}
            icone="IconCheck"
            onPress={() => onVotar(ponto, "CONFIRMA")}
          />
          <BotaoVoto
            testID={`contestar-${ponto.id}`}
            ativo={ponto.meuVoto === "CONTESTA"}
            contagem={ponto.contestacoes}
            icone="IconErrorCircle"
            onPress={() => onVotar(ponto, "CONTESTA")}
          />
        </View>
      )}
    </View>
  );
}

function Secao({ titulo, itens, children }: { titulo: string; itens: PontoAtencao[]; children: JSX.Element }): JSX.Element | null {
  if (itens.length === 0) return null;
  return (
    <View className="gap-2.5">
      <Typography.Paragraph type="body-xs" color="muted">
        {titulo}
      </Typography.Paragraph>
      {children}
    </View>
  );
}

export default function PontosAtencaoScreen(): JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const [estado, setEstado] = useState<Estado>({ status: "loading" });
  const ativoRef = useRef(true);

  useEffect(
    () => () => {
      ativoRef.current = false;
    },
    [],
  );

  const carregar = useCallback(async () => {
    if (!accessToken) {
      setEstado({ status: "erro", mensagem: "Faça login para ver os pontos de atenção." });
      return;
    }
    // Só a primeira carga (ou uma nova tentativa depois de erro) mostra o
    // spinner de tela cheia: como isto roda a cada foco, voltar de criar,
    // editar ou apagar apagaria a lista inteira por um instante em vez de
    // atualizá-la no lugar.
    setEstado((atual) => (atual.status === "ready" ? atual : { status: "loading" }));
    try {
      const pontos = await getPontosAtencao(accessToken, { incluirVencidos: true });
      if (!ativoRef.current) return;
      setEstado({ status: "ready", pontos });
    } catch (error) {
      if (!ativoRef.current) return;
      setEstado({ status: "erro", mensagem: describeApiError(error) });
    }
  }, [accessToken]);

  // useFocusEffect substitui o useEffect de montagem — ele já dispara no
  // primeiro foco, e também recarrega toda vez que a tela volta ao foco.
  // Criar, editar, apagar e corrigir todos voltam via router.back() para
  // esta tela, que já estava montada e carregada uma vez — sem isto, o item
  // criado/editado não aparece e o apagado continua na lista até sair e
  // reentrar na tela.
  useFocusEffect(
    useCallback(() => {
      void carregar();
    }, [carregar]),
  );

  async function votar(ponto: PontoAtencao, valor: ValorVoto): Promise<void> {
    if (!accessToken) return;
    try {
      // Tocar no botão que já é o meu voto desfaz o voto — repetir o PUT
      // recriaria o mesmo voto, então a ação certa é o DELETE.
      const atualizado =
        ponto.meuVoto === valor
          ? await deleteVotoPontoAtencao(accessToken, ponto.id)
          : await putVotoPontoAtencao(accessToken, ponto.id, valor);
      if (!ativoRef.current) return;
      setEstado((atual) =>
        atual.status === "ready"
          ? { status: "ready", pontos: atual.pontos.map((p) => (p.id === atualizado.id ? atualizado : p)) }
          : atual,
      );
    } catch (error) {
      if (!ativoRef.current) return;
      setEstado({ status: "erro", mensagem: describeApiError(error) });
    }
  }

  function corrigir(ponto: PontoAtencao): void {
    router.push(`/ponto-de-atencao/${ponto.id}`);
  }

  return (
    <View className="flex-1 bg-background">
      <AppBar title="Pontos de atenção" onAdd={() => router.push("/ponto-de-atencao/novo")} />

      {estado.status === "loading" ? (
        <View className="flex-1 items-center justify-center">
          <Spinner testID="pontos-atencao-lista-loading" />
        </View>
      ) : estado.status === "erro" ? (
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Typography.Paragraph testID="pontos-atencao-lista-erro" color="muted" align="center">
            {estado.mensagem}
          </Typography.Paragraph>
          <Button variant="outline" size="sm" onPress={() => void carregar()}>
            Tentar novamente
          </Button>
        </View>
      ) : (
        (() => {
          const { proximos, contestados, vencidos } = agrupar(estado.pontos, new Date());
          if (proximos.length === 0 && contestados.length === 0 && vencidos.length === 0) {
            return (
              <View className="flex-1 items-center justify-center px-6">
                <Typography.Paragraph testID="pontos-atencao-lista-vazia" color="muted" align="center">
                  Nenhuma prova ou trabalho cadastrado.
                </Typography.Paragraph>
              </View>
            );
          }
          return (
            <ScrollView
              testID="pontos-atencao-lista-scroll"
              className="flex-1 px-6"
              contentContainerClassName="gap-5 pb-8"
              showsVerticalScrollIndicator={false}
            >
              <Secao titulo="Próximos" itens={proximos}>
                <View className="gap-2.5">
                  {proximos.map((ponto) => (
                    <ItemPontoAtencao
                      key={ponto.id}
                      ponto={ponto}
                      vencido={false}
                      onVotar={votar}
                      onCorrigir={corrigir}
                    />
                  ))}
                </View>
              </Secao>

              <Secao titulo="Contestados" itens={contestados}>
                <View className="gap-2.5">
                  {contestados.map((ponto) => (
                    <ItemPontoAtencao
                      key={ponto.id}
                      ponto={ponto}
                      vencido={false}
                      onVotar={votar}
                      onCorrigir={corrigir}
                    />
                  ))}
                </View>
              </Secao>

              <Secao titulo="Vencidos" itens={vencidos}>
                <View className="gap-2.5">
                  {vencidos.map((ponto) => (
                    <ItemPontoAtencao
                      key={ponto.id}
                      ponto={ponto}
                      vencido
                      onVotar={votar}
                      onCorrigir={corrigir}
                    />
                  ))}
                </View>
              </Secao>
            </ScrollView>
          );
        })()
      )}

      {/* Rodapé fixo, fora da área rolável — mesmo padrão de documentos.tsx e
          arvore-dependencias.tsx: sem isto o único jeito de sair desta tela
          era o gesto de voltar da plataforma, já que o stack raiz roda com
          headerShown: false. */}
      <View className="px-4 pt-3.5 bg-background" style={{ paddingBottom: insets.bottom + 16 }}>
        <Button variant="danger-soft" onPress={() => router.back()}>
          Fechar
        </Button>
      </View>
    </View>
  );
}

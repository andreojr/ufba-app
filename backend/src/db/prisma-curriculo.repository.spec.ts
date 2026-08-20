import { PrismaCurriculoRepository } from './prisma-curriculo.repository';
import { PrismaService } from './prisma.service';
import type { EstruturaResumo } from '../sigaa-engine/parsers/estrutura-resumo';
import type { ComponenteCurricularSalvo } from '../curriculo/curriculo.repository';

describe('PrismaCurriculoRepository', () => {
  const prisma = new PrismaService();
  const repo = new PrismaCurriculoRepository(prisma);

  beforeEach(async () => {
    await prisma.componenteCurricular.deleteMany();
    await prisma.estruturaCurricular.deleteMany();
    await prisma.curso.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('round-trips the course directory, replacing it wholesale', async () => {
    await repo.salvarCursos([
      { idSigaa: '1', nome: 'CURSO A', sede: 'SALVADOR', nivel: 'G' },
      { idSigaa: '2', nome: 'CURSO B', sede: 'SALVADOR', nivel: 'G' },
    ]);
    await repo.salvarCursos([
      { idSigaa: '3', nome: 'CURSO C', sede: 'SALVADOR', nivel: 'G' },
    ]);

    const cursos = await repo.buscarCursos();
    expect(cursos).toEqual([
      { idSigaa: '3', nome: 'CURSO C', sede: 'SALVADOR', nivel: 'G' },
    ]);
  });

  it('finds a single course by id', async () => {
    await repo.salvarCursos([
      { idSigaa: '1', nome: 'CURSO A', sede: 'SALVADOR', nivel: 'G' },
    ]);
    expect(await repo.buscarCursoPorId('1')).toEqual({
      idSigaa: '1',
      nome: 'CURSO A',
      sede: 'SALVADOR',
      nivel: 'G',
    });
    expect(await repo.buscarCursoPorId('nao-existe')).toBeNull();
  });

  it('round-trips a curriculum structure with its componentes', async () => {
    await repo.salvarCursos([
      { idSigaa: '1', nome: 'CURSO A', sede: 'SALVADOR', nivel: 'G' },
    ]);

    const resumo: EstruturaResumo = {
      anoPeriodoImplementacao: '2025.2',
      cargaHorariaTotal: 3610,
      cargaHorariaObrigatoria: 3150,
      cargaHorariaOptativaMinima: 360,
      cargaHorariaComplementarMinima: 100,
      prazoMinimoSemestres: 12,
      prazoMedioSemestres: 12,
      prazoMaximoSemestres: 18,
      formFields: {},
      componentes: [
        {
          idSigaa: '34997',
          codigo: 'FISD36',
          nome: 'FÍSICA GERAL TEÓRICA I',
          cargaHoraria: 60,
          natureza: 'OBRIGATORIA',
          periodo: 1,
          jsfParams: {},
        },
      ],
    };
    const componentesDetalhados: ComponenteCurricularSalvo[] = [
      {
        ...resumo.componentes[0],
        unidadeResponsavel: 'DEPARTAMENTO DE FÍSICA GERAL/IFIS',
        preRequisito: null,
        coRequisito: null,
        equivalencias: '( FIS121 )',
      },
    ];
    const staleAfter = new Date('2026-09-19T00:00:00Z');

    await repo.salvarEstrutura(
      '1',
      'e1',
      'G20251',
      resumo,
      componentesDetalhados,
      staleAfter,
    );

    const salva = await repo.buscarEstrutura('1');
    expect(salva?.codigo).toBe('G20251');
    expect(salva?.cargaHorariaTotal).toBe(3610);
    expect(salva?.componentes).toHaveLength(1);
    expect(salva?.componentes[0]).toMatchObject({
      codigo: 'FISD36',
      preRequisito: null,
      equivalencias: '( FIS121 )',
    });
  });

  it('replaces a structure wholesale on re-resolution, dropping componentes no longer in the matrix', async () => {
    await repo.salvarCursos([
      { idSigaa: '1', nome: 'CURSO A', sede: 'SALVADOR', nivel: 'G' },
    ]);
    const baseResumo: EstruturaResumo = {
      anoPeriodoImplementacao: '2025.2',
      cargaHorariaTotal: 100,
      cargaHorariaObrigatoria: 100,
      cargaHorariaOptativaMinima: 0,
      cargaHorariaComplementarMinima: 0,
      prazoMinimoSemestres: 1,
      prazoMedioSemestres: 1,
      prazoMaximoSemestres: 1,
      formFields: {},
      componentes: [
        {
          idSigaa: '1',
          codigo: 'AAA000',
          nome: 'MATÉRIA ANTIGA',
          cargaHoraria: 60,
          natureza: 'OBRIGATORIA',
          periodo: 1,
          jsfParams: {},
        },
      ],
    };
    await repo.salvarEstrutura(
      '1',
      'e1',
      'G20251',
      baseResumo,
      [
        {
          ...baseResumo.componentes[0],
          unidadeResponsavel: null,
          preRequisito: null,
          coRequisito: null,
          equivalencias: null,
        },
      ],
      new Date(),
    );

    const novoResumo: EstruturaResumo = {
      ...baseResumo,
      componentes: [
        {
          idSigaa: '2',
          codigo: 'BBB000',
          nome: 'MATÉRIA NOVA',
          cargaHoraria: 60,
          natureza: 'OBRIGATORIA',
          periodo: 1,
          jsfParams: {},
        },
      ],
    };
    await repo.salvarEstrutura(
      '1',
      'e1',
      'G20251',
      novoResumo,
      [
        {
          ...novoResumo.componentes[0],
          unidadeResponsavel: null,
          preRequisito: null,
          coRequisito: null,
          equivalencias: null,
        },
      ],
      new Date(),
    );

    const salva = await repo.buscarEstrutura('1');
    expect(salva?.componentes.map((c) => c.codigo)).toEqual(['BBB000']);
  });

  it('refreshes the directory wholesale without a FK violation, even when a course already has a resolved estrutura', async () => {
    await repo.salvarCursos([
      { idSigaa: '1', nome: 'CURSO A', sede: 'SALVADOR', nivel: 'G' },
    ]);
    const resumo: EstruturaResumo = {
      anoPeriodoImplementacao: '2025.2',
      cargaHorariaTotal: 100,
      cargaHorariaObrigatoria: 100,
      cargaHorariaOptativaMinima: 0,
      cargaHorariaComplementarMinima: 0,
      prazoMinimoSemestres: 1,
      prazoMedioSemestres: 1,
      prazoMaximoSemestres: 1,
      formFields: {},
      componentes: [],
    };
    await repo.salvarEstrutura('1', 'e1', 'G20251', resumo, [], new Date());

    // The old salvarCursos deleteMany() over Curso would have thrown an FK
    // violation here (ON DELETE RESTRICT) because course '1' still has an
    // EstruturaCurricular row pointing at it — see I4.
    await expect(
      repo.salvarCursos([
        { idSigaa: '2', nome: 'CURSO B', sede: 'SALVADOR', nivel: 'G' },
      ]),
    ).resolves.toBeUndefined();

    expect(await repo.buscarCursos()).toEqual([
      { idSigaa: '2', nome: 'CURSO B', sede: 'SALVADOR', nivel: 'G' },
    ]);
    // The cascade also took the now-orphaned estrutura with it.
    expect(await repo.buscarEstrutura('1')).toBeNull();
  });
});

import { fillScheduleGrid } from './atestado-grid';

// The atestado's "Tabela de Horários" ships with every cell as
// <span id="<day>_<slot>">---</span>, then a script fills them in via
// getElementById(...).innerHTML. Since we strip scripts, we must apply those
// assignments server-side or the grid renders empty ("---").
const GRID_HTML = `
  <table id="horario">
    <tr><td><span id="1_11">---</span></td><td><span id="2_11">---</span></td></tr>
    <tr><td><span id="2_15">---</span></td><td><span id="3_11">---</span></td></tr>
  </table>
  <script type="text/javascript">
    var elem = document.getElementById('2_15');
    if (elem) elem.innerHTML = 'ENGG54';

    var elem = document.getElementById('3_11');
    if (elem) elem.innerHTML = 'ENGG67';

    var elem = document.getElementById('2_11');
    if (elem) elem.innerHTML = 'ENGG64';
  </script>
`;

describe('fillScheduleGrid', () => {
  it('replaces a grid cell placeholder with the code its fill-script assigns', () => {
    const out = fillScheduleGrid(GRID_HTML);

    expect(out).toContain('<span id="2_15">ENGG54</span>');
    expect(out).toContain('<span id="3_11">ENGG67</span>');
    expect(out).toContain('<span id="2_11">ENGG64</span>');
  });

  it('leaves cells with no assignment as their "---" placeholder', () => {
    const out = fillScheduleGrid(GRID_HTML);

    expect(out).toContain('<span id="1_11">---</span>');
  });

  it('returns the html unchanged when there are no fill assignments', () => {
    const html =
      '<span id="1_11">---</span><script>doSomethingElse();</script>';

    expect(fillScheduleGrid(html)).toBe(html);
  });

  it('does not touch getElementById calls that are not grid innerHTML fills', () => {
    const html =
      '<span id="x">---</span>' +
      "<script>var e = document.getElementById('x'); e.style.color='red';</script>";

    expect(fillScheduleGrid(html)).toBe(html);
  });
});

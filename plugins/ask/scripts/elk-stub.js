// Stands in for elkjs (1.6 MB, over the 1 MB a hooks module may import): the
// box-drawing renderer never lays out with ELK, and the SVG renderer needs it
// only for flowcharts and state, class and ER diagrams, which then throw this.
export default class ELK {
  constructor() {
    throw new Error('ELK layout is not bundled')
  }
}

samples('github:tidalcycles/dirt-samples')

stack(
  s("bd:0 ~ bd:0 ~ sn:0 ~ bd:0 ~").gain(0.9),
  s("~ hh:0 ~ hh:0 ~ hh:0 ~ hh:0").gain(0.25),

  note("c2 ~ eb2 ~ f2 ~ g2 ~")
    .s("sawtooth")
    .slow(2)
    .gain(0.45),

  note("c4 eb4 g4 bb4")
    .s("superpiano")
    .slow(4)
    .gain(0.3)
)

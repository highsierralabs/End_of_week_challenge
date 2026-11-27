// Reference values the solver is checked against.

/**
 * The first 25 Dirichlet eigenvalues of the GWW isospectral drums (legs of length 2), from
 * T. A. Driscoll, "Eigenmodes of isospectral drums", SIAM Review 39 (1997) 1-17, Table 3.1.
 * "All digits shown are believed to be correct."
 */
export const DRISCOLL_GWW = [
  2.53794399980, 3.65550971352, 5.17555935622, 6.53755744376, 7.24807786256,
  9.20929499840, 10.5969856913, 11.5413953956, 12.3370055014, 13.0536540557,
  14.3138624643, 15.8713026200, 16.9417516880, 17.6651184368, 18.9810673877,
  20.8823950433, 21.2480051774, 22.2328517930, 23.7112974848, 24.4792340693,
  24.6740110027, 26.0802400997, 27.3040189211, 28.1751285815, 29.5697729132,
];

/**
 * The lowest nonzero eigenvalues lambda a^4 (lambda = rho_s d omega^2 / D) of a completely free square plate
 * [-a, a]^2 with Poisson's ratio 0.225, in ascending order across the four symmetry classes (the pairs are
 * the degenerate SA/AS modes). From "Eigenfrequencies and eigenmodes for a thin rectangular elastic plate with
 * free edges", R. Porter, School of Mathematics, University of Bristol, technical report, April 2017,
 * Table 1, N = 48 column.
 */
export const FREE_SQUARE_PLATE = [12.4552, 25.9900, 35.6495, 80.9341, 80.9341, 235.500, 235.500, 269.437, 320.969, 375.420];

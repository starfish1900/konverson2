# Konverson confirmed rules

Based on the supplied Konverson document, credited to XaXua Games, and the author's clarifications in this task.

1. The board is 9×9, 11×11, 13×13, or 15×15. Colors A, B, C, D act in that fixed order. A/C and B/D are the two alliances. Either color of an alliance may win.
2. Pawns touch along sides or corners. Distance is Chebyshev distance: the maximum of the row and column differences.
3. At the start of a color's turn, all its NEW pawns become OLD. A pawn is protected until its own color's next turn, not just the next player's turn.
4. The opening color A places only one pawn. Other color turns place two, unless no second legal placement remains. A first placement that prevents a second is still legal even when another first choice would allow a pair.
5. Pawns are placed only on empty squares. Two pawns placed in the same turn must be distance three or more apart. Existing pawns impose no such distance restriction.
6. Interior squares are at least two rows/columns inward from the outside edge. Preborders are the adjacent inner ring, borders are non-corner edge squares, and corners are the four corner squares.
7. A preborder placement must touch an interior pawn. A border placement must touch a preborder pawn. A corner placement must touch its unique diagonal preborder pawn. Any color or posture can supply support.
8. After each placement, scan all eight straight directions. Capture an uninterrupted run of one other color, all OLD, bracketed between the placed pawn and another pawn of the active color. Empty squares, mixed-color runs and NEW pawns interrupt the line. Allied colors may be captured.
9. Apply that placement's captures together. Captured pawns change color and remain OLD. They do not trigger cascades. The second placement can use a pawn converted by the first as an endpoint.
10. After each placement and its conversions, check immediately for a connexion. A connexion is a touching chain of one color joining north to south or west to east. Both OLD and NEW pawns count. Corners never count, including as intermediate chain links. A first-placement victory ends the match before any second placement.
11. If a color has no legal first placement, the match is a no-connexion draw. Lack of a second placement only advances to the next color.

Corners remain useful for captures but cannot support a connexion. No pass, swap rule, alternating starting color, or human-versus-human mode is added.

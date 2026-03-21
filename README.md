# LLLM Semantic Comparer

## TL;DR

- HTML 압축 자동연구를 하다가, 압축기보다 먼저 의미 보존을 안정적으로 판정하는 평가기가 필요해서 분리된 프로젝트입니다.
- 두 문서를 5회 평가한 뒤 `trimean`과 수학적 가산으로 최종 점수와 verdict를 계산합니다.
- 경계 사례 기준으로 현재 최종 `overall` 밴드는 `69~72`, 즉 `3점대` 수준까지 안정화했습니다.

HTML을 LLM 컨텍스트용으로 얼마나 잘 압축할 수 있는지 자동으로 연구하다가 분리된 의미 보존 평가 도구입니다.

처음 목적은 단순했습니다. 원본 HTML이나 문서를 요약하거나 압축한 뒤, 그 결과가 원본 의미를 얼마나 보존했는지 자동으로 점수화하고 싶었습니다. 그런데 연구를 진행할수록 압축기보다 먼저 필요한 것이 생겼습니다. 바로 "압축 결과가 정말 좋은가?"를 안정적으로 판정하는 평가기였습니다. 그래서 이 저장소는 압축기 자체보다 먼저, 압축 품질을 비교할 수 있는 독립적인 semantic comparer로 정리됐습니다.

이건 HTML 압축 연구만의 문제도 아니었습니다. AI 기반 도구는 점점 더 많이 만들어지는데, 정작 무엇이 정말 잘 작동하는지 판단하는 평가지표와 평가 도구는 빈약한 경우가 많았습니다. 그 결과 "일단 생성은 되지만 신뢰하기 어려운 도구"가 계속 늘어나는 흐름도 보였습니다. 그래서 생성기만 만드는 것이 아니라, 생성 결과를 비교하고 걸러낼 수 있는 평가 도구 자체도 같이 필요하다고 생각하게 됐습니다.

## 문제의식

HTML 압축 자동연구에서는 압축률만 보면 안 됩니다. 토큰 수가 줄어도 중요한 날짜, 숫자, 책임자, 조건, 예외, 지표가 빠지면 실패입니다. 반대로 표현만 달라지고 사실은 그대로 남아 있으면 좋은 압축일 수 있습니다.

그래서 이 도구는 "얼마나 짧아졌는가"가 아니라 아래 질문을 보도록 설계했습니다.

- 원본과 압축본이 같은 사건, 결정, 사실을 말하는가
- 압축 과정에서 어떤 정보가 빠졌는가
- 빠진 정보가 사소한가, 아니면 핵심인가
- 같은 입력을 반복 평가했을 때 결과가 어느 정도 안정적인가

조금 더 넓게 보면, 이 저장소는 "AI가 무언가를 만들어내는 능력"보다 "그 결과를 신뢰할 수 있는 기준으로 평가하는 능력"이 더 중요해지는 시점에 대한 문제의식에서 나온 작업이기도 합니다.

## 이 도구가 하는 일

두 문서를 읽고 OpenRouter 기반 LLM으로 다음을 평가합니다.

- 의미가 얼마나 같은지
- 정보량이 얼마나 비슷한지
- 어느 방향으로 정보가 빠졌는지
- 최종적으로 어느 정도 동등하다고 볼 수 있는지

핵심 지표는 다음 네 가지입니다.

- `semantic_similarity`
- `information_amount_parity`
- `doc_a_coverage_by_doc_b`
- `doc_b_coverage_by_doc_a`

그리고 이 네 지표를 바탕으로 최종 `overall_equivalence`와 `verdict`를 계산합니다.

## 핵심 결과

아래 값들은 이 저장소의 예제 파일들로 실제 CLI를 실행해 얻은 기록입니다. 모델과 시점에 따라 약간 변할 수 있지만, 현재 도구가 어떤 식으로 반응하는지 보여주는 기준선으로 남겨둡니다.

### 원본 / preserved / compressed / lost 세트

원본 파일:
- [source-original.txt](./examples/source-original.txt)

비교 결과:

| case | overall | semantic | info parity | A->B | B->A | verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| preserved | 97 | 97 | 96 | 98 | 98 | highly_equivalent |
| compressed | 84 | 88 | 70 | 72 | 96 | partially_equivalent |
| lost | 40 | 38 | 28 | 14 | 81 | materially_different |

읽는 법:
- `preserved`는 거의 완전한 패러프레이즈로 잘 인식됐습니다.
- `compressed`는 핵심 의미는 강하게 남았지만 세부 운영 정보가 빠져 info parity와 A->B coverage가 내려갔습니다.
- `lost`는 원본의 구체 정보 대부분이 사라져 materially different로 떨어졌습니다.

### 경계 사례 안정성 기록

파일:
- [partial-overlap-a.txt](./examples/partial-overlap-a.txt)
- [partial-overlap-b.txt](./examples/partial-overlap-b.txt)

도구 전체를 3번 독립 호출했을 때의 최종 집계 밴드:

| metric | min | max | band width | average |
| --- | ---: | ---: | ---: | ---: |
| overall | 69 | 72 | 3 | 70.7 |
| semantic | 69 | 70 | 1 | 69.7 |
| info parity | 85 | 86 | 1 | 85.3 |
| A->B | 63 | 70 | 7 | 66.3 |
| B->A | 63 | 66 | 3 | 64.7 |

관찰:
- verdict는 3번 모두 `partially_equivalent`로 유지됐습니다.
- `semantic`과 `info parity`는 비교적 안정적이었습니다.
- coverage는 semantic보다 더 흔들렸지만, 전체 판정이 뒤집히지는 않았습니다.

## 현재 방법

한 번의 비교는 내부적으로 이렇게 진행됩니다.

1. 같은 문서쌍을 5번 평가합니다.
2. 각 실행에서 semantic, info parity, 양방향 coverage를 얻습니다.
3. 각 수치를 `trimean`으로 집계합니다.
4. 집계된 수치로 `overall_equivalence`와 `verdict`를 계산합니다.
5. 집계 점수 벡터에 가장 가까운 실행 1개를 대표 run으로 골라 summary와 포인트 목록에 사용합니다.

이 구조는 "설명 가능한 점수"와 "반복 실행 안정성" 사이의 균형을 맞추기 위해 선택했습니다.

## 합산 수학 로직

### 1. 5회 실행

같은 문서쌍을 5번 평가해서 각 실행마다 아래 값을 얻습니다.

- `semantic_similarity`
- `information_amount_parity`
- `doc_a_coverage_by_doc_b`
- `doc_b_coverage_by_doc_a`

### 2. 각 항목을 `trimean`으로 집계

5개 값을 정렬해서:

- `Q1 = 두 번째 값`
- `Median = 세 번째 값`
- `Q3 = 네 번째 값`

그 다음 아래 식으로 집계합니다.

```text
trimean = (Q1 + 2 * Median + Q3) / 4
```

즉 5개 중 가운데 3개를 더 신뢰하고, 특히 중앙값에 2배 가중치를 줍니다.

### 3. overall score 계산

집계된 4개 점수로 최종 `overall_equivalence`를 계산합니다.

```text
overall =
  0.50 * semantic_similarity +
  0.15 * information_amount_parity +
  0.175 * doc_a_coverage_by_doc_b +
  0.175 * doc_b_coverage_by_doc_a
```

마지막에는 0~100 범위로 clamp하고 정수 반올림합니다.

가중치 의도:
- 의미 유사도는 가장 중요하므로 50%
- 정보량 유사도는 중요하지만 의미보다 낮게 15%
- 양방향 coverage는 각각 17.5%

### 4. verdict 계산

최종 verdict는 LLM의 자유 판단이 아니라 집계된 점수에서 규칙적으로 결정합니다.

- `highly_equivalent`
  - `semantic >= 92`
  - `info_parity >= 90`
  - `min(coverage_a_to_b, coverage_b_to_a) >= 90`

- `mostly_equivalent`
  - `semantic >= 80`
  - `overall >= 74`
  - `info_parity >= 70`
  - `min(coverage_a_to_b, coverage_b_to_a) >= 75`

- `partially_equivalent`
  - `semantic >= 40`
  - `overall >= 35`

- 그 외는 `materially_different`

### 5. 요약 문장 선택

summary, shared points, gap notes 같은 서술형 필드는 5개 실행 중에서 집계된 점수 벡터에 가장 가까운 실행 1개를 대표 run으로 골라 사용합니다.

## 개선 과정

이 도구는 처음부터 지금처럼 안정적이지 않았습니다. 아래는 같은 경계 사례를 반복 실행하면서 점수 밴드를 좁혀간 기록입니다.

기준 문서쌍:
- [partial-overlap-a.txt](./examples/partial-overlap-a.txt)
- [partial-overlap-b.txt](./examples/partial-overlap-b.txt)

### 초기 상태: 단일 호출 + LLM이 overall / verdict 직접 결정

같은 입력을 5번 돌렸을 때:

- overall: `65, 70, 65, 70, 78`
- semantic: `70, 75, 70, 75, 82`
- info parity: `80, 80, 80, 80, 90`
- A->B: `55, 60, 55, 60, 70`
- B->A: `60, 55, 45, 70, 76`
- verdict: `partially_equivalent` 1회, `mostly_equivalent` 4회

밴드:

| metric | min | max | band width |
| --- | ---: | ---: | ---: |
| overall | 65 | 78 | 13 |
| semantic | 70 | 82 | 12 |
| info parity | 80 | 90 | 10 |
| A->B | 55 | 70 | 15 |
| B->A | 45 | 76 | 31 |

문제:
- verdict가 뒤집혔습니다.
- coverage는 특히 많이 흔들렸습니다.
- 경계 사례에서 한 번 실행 결과를 신뢰하기 어려웠습니다.

### 중간 상태: 프롬프트 보수화 + 수학적 calibration

여기서는 LLM이 세부 점수만 내고, `overall`과 `verdict`는 코드에서 재계산하도록 바꿨습니다.

한 실험에서는:

- overall: `71, 72, 72, 81, 64`
- semantic: `70, 72, 70, 85, 70`
- info parity: `85, 85, 85, 92, 85`
- A->B: `65, 65, 70, 70, 45`
- B->A: `65, 65, 70, 70, 45`
- verdict: `partially_equivalent` 4회, `mostly_equivalent` 1회

밴드:

| metric | min | max | band width |
| --- | ---: | ---: | ---: |
| overall | 64 | 81 | 17 |
| semantic | 70 | 85 | 15 |
| info parity | 85 | 92 | 7 |
| A->B | 45 | 70 | 25 |
| B->A | 45 | 70 | 25 |

개선점:
- verdict는 이전보다 덜 흔들렸습니다.
- 하지만 경계 사례 점수 폭은 여전히 넓었습니다.

### 최종 상태: 5회 `trimean` + 수학적 가산

도구 전체를 3번 독립 호출했을 때의 최종 밴드:

| metric | min | max | band width | average |
| --- | ---: | ---: | ---: | ---: |
| overall | 69 | 72 | 3 | 70.7 |
| semantic | 69 | 70 | 1 | 69.7 |
| info parity | 85 | 86 | 1 | 85.3 |
| A->B | 63 | 70 | 7 | 66.3 |
| B->A | 63 | 66 | 3 | 64.7 |

실제 3회 최종 결과:

- call 1: `overall 71`, `semantic 70`, `info 85`, `A->B 66`, `B->A 65`
- call 2: `overall 69`, `semantic 69`, `info 85`, `A->B 63`, `B->A 63`
- call 3: `overall 72`, `semantic 70`, `info 86`, `A->B 70`, `B->A 66`

의미:
- 최종 overall band가 `3점대`로 안착했습니다.
- semantic / info parity는 거의 고정 수준까지 좁아졌습니다.
- coverage는 아직 상대적으로 더 흔들리지만, verdict는 3회 모두 `partially_equivalent`로 유지됐습니다.

## 예제 케이스

저장소에는 연구, 검증, 회귀 확인용 예제가 들어 있습니다.

- 거의 완전한 패러프레이즈
- 핵심은 유지하지만 정보가 많이 압축된 버전
- 일부만 겹치는 버전
- 사실상 다른 의미가 된 버전
- 원본 / preserved / compressed / lost 예제 세트

이 예제들은 프롬프트 조정, verdict 경계 보정, 반복 실행 안정성 확인에 사용했습니다.

## 실행 방법

### Requirements

- Node.js 18+
- `OPENROUTER_API_KEY`
- `OPENROUTER_DEFAULT_MODEL`

### Setup

`~/.zshrc` 같은 셸 설정 파일에 아래처럼 넣어두면 됩니다. 현재 프로세스 환경변수가 비어 있으면 이 CLI가 `~/.zshrc`에서 `OPENROUTER_API_KEY`, `OPENROUTER_DEFAULT_MODEL`을 fallback으로 읽습니다.

```bash
export OPENROUTER_API_KEY=your_key_here
export OPENROUTER_DEFAULT_MODEL=openai/gpt-4.1-mini
```

적용 후에는 `source ~/.zshrc`를 실행하거나 새 셸을 열면 됩니다.

의존성은 없습니다. 바로 실행하면 됩니다.

### Usage

기본 실행:

```bash
npm run compare -- ./doc-a.txt ./doc-b.txt
```

JSON 결과:

```bash
npm run compare -- ./doc-a.txt ./doc-b.txt --json
```

모델 강제 지정:

```bash
npm run compare -- ./doc-a.txt ./doc-b.txt --model anthropic/claude-3.7-sonnet
```

저장소 예제로 시험:

```bash
npm run compare -- ./examples/highly-equivalent-a.txt ./examples/highly-equivalent-b.txt
```

여러 예제를 한 번에 실행:

```bash
npm run example-suite
```

## 출력 해석

기본 텍스트 출력에는 다음이 포함됩니다.

- 5회 샘플링 결과와 `trimean` 집계 정보
- `overall_equivalence`
- `semantic_similarity`
- `information_amount_parity`
- `doc_a_coverage_by_doc_b`
- `doc_b_coverage_by_doc_a`
- 대표 summary
- 공통 정보 / A에만 있는 정보 / B에만 있는 정보 / gap notes

대체로 이렇게 읽으면 됩니다.

- `semantic_similarity`가 높다
  - 같은 의미를 말하고 있을 가능성이 큽니다.
- `information_amount_parity`가 낮다
  - 한쪽이 훨씬 더 자세합니다.
- `A->B coverage`가 낮고 `B->A coverage`가 높다
  - B가 A를 압축한 형태일 가능성이 큽니다.
- `semantic_similarity`도 낮고 coverage도 낮다
  - 사실상 의미가 많이 깨진 것입니다.

## 한계

- LLM 평가이므로 절대적인 진실 판정기는 아닙니다.
- 무료 모델은 rate limit과 응답 포맷 흔들림이 있습니다.
- 현재는 UTF-8 텍스트 입력 기준입니다.
- summary와 bullet 포인트는 대표 실행 1개를 사용하므로, 점수보다 표현이 조금 더 흔들릴 수 있습니다.

그래도 현재 구조는 "압축 후보 여러 개를 자동으로 비교하고, 어떤 방식이 의미 보존에 유리한지 연구하는 용도"에는 꽤 잘 맞습니다.

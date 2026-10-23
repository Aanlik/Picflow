import httpx
import pytest

from pixcake_bridge.client import ApiError, Picflow


@pytest.mark.parametrize("status", [401, 403, 404, 429, 500, 502, 503])
async def test_http_errors(status, monkeypatch):
    async def sleep(_):
        pass
    monkeypatch.setattr("pixcake_bridge.client.asyncio.sleep", sleep)
    client = Picflow("http://127.0.0.1:3000", httpx.MockTransport(lambda r: httpx.Response(status)))
    with pytest.raises(ApiError) as e:
        await client.photos(1)
    assert e.value.status == status
    await client.close()


async def test_network_retry(monkeypatch):
    calls = []
    async def sleep(_):
        pass
    monkeypatch.setattr("pixcake_bridge.client.asyncio.sleep", sleep)
    def transport(req):
        calls.append(req)
        raise httpx.ConnectError("offline")
    client = Picflow("http://127.0.0.1:3000", httpx.MockTransport(transport))
    with pytest.raises(ApiError):
        await client.photos(1)
    assert len(calls) == 3
    await client.close()


async def test_pagination_uses_integrated_photo_route():
    def transport(req):
        assert "mark_source" not in req.url.params
        assert req.url.path == "/api/internal/bridge/events/1/photos"
        page = int(req.url.params["page"])
        return httpx.Response(200, json={"photos": [{"id": page}], "pagination": {"pages": 2}})
    client = Picflow("http://127.0.0.1:3000", httpx.MockTransport(transport))
    assert await client.photos(1) == [{"id": 1}, {"id": 2}]
    await client.close()


async def test_integrated_client_uses_loopback_marker_without_bearer_token():
    def transport(req):
        assert req.headers["x-picpeak-integrated-bridge"] == "1"
        assert "authorization" not in req.headers
        assert req.url.path.startswith("/api/internal/bridge/")
        return httpx.Response(200, json={"photos": [], "pagination": {"pages": 1, "filtered": 0}})

    client = Picflow("http://127.0.0.1:3000", transport=httpx.MockTransport(transport))
    assert await client.photos(1) == []
    await client.close()


async def test_lost_upload_is_uncertain_and_not_retried(tmp_path):
    calls = []
    def transport(req):
        calls.append(req)
        assert b'replaces_photo_id' in req.read()
        raise httpx.ReadTimeout("response lost")
    file = tmp_path / "a.jpg"
    file.write_bytes(b"jpeg")
    client = Picflow("http://127.0.0.1:3000", httpx.MockTransport(transport))
    with pytest.raises(ApiError) as e:
        await client.replace(1, 3, file, "a.jpg")
    assert e.value.uncertain
    assert len(calls) == 1
    await client.close()

async def test_corrupt_replacement_is_a_known_failure_with_actionable_message(tmp_path):
    file = tmp_path / "broken.jpg"
    file.write_bytes(b"not an image")
    client = Picflow("http://127.0.0.1:3000", httpx.MockTransport(
        lambda _: httpx.Response(422, json={"code": "INVALID_IMAGE_CONTENT"})))
    with pytest.raises(ApiError) as error:
        await client.replace(1, 3, file, "broken.jpg")
    assert error.value.status == 422
    assert not error.value.uncertain
    assert "重新导出" in str(error.value)
    await client.close()
